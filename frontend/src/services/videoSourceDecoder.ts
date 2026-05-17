/**
 * Per-source video frame extractor for the export pipeline.
 *
 * Pipeline: File bytes → mp4box (demux samples) → VideoDecoder (decode to
 * VideoFrames) → frame lookup by source-time.
 *
 * The compositor advances through timeline-time monotonically, so for each
 * clip the requested source-time advances monotonically too (modulo speed).
 * We exploit that: we keep a small ring of recent frames and a queue of
 * pending samples to feed the decoder just-in-time. As source-time advances
 * past a frame we `.close()` it to free GPU memory.
 *
 * Non-MP4 sources fall back to HTMLVideoElement + seek-and-grab in
 * `FallbackVideoSourceDecoder`. Slower but works for WebM, MOV-with-non-
 * H.264, etc.
 */

import { createFile, DataStream, type ISOFile, type MP4BoxBuffer, type Track, type VisualSampleEntry } from 'mp4box';

// DataStream defaults to BIG_ENDIAN; that's what mp4 boxes use.

export interface VideoSourceDecoder {
  /** Returns the most-recently-decoded frame whose source time ≤ `sourceTime`.
   *  Advances decode as needed. Null if past the end of the source. */
  frameAt(sourceTime: number): Promise<VideoFrame | null>;
  /** Free all resources. Closes any pending frames. */
  close(): Promise<void>;
}

/** Open a decoder for a given media file. Tries MP4+WebCodecs first; falls
 *  back to HTMLVideoElement extraction on non-MP4 containers. */
export async function openVideoSource(file: File): Promise<VideoSourceDecoder> {
  // Quick magic-byte sniff for MP4. ftyp box starts at offset 4.
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70; // 'ftyp'

  if (isMp4) {
    try {
      return await Mp4WebCodecsDecoder.open(file);
    } catch (e) {
      console.warn('mp4box/WebCodecs decode failed, falling back to HTMLVideoElement:', e);
    }
  }
  // Non-MP4 or MP4-with-unsupported-codec: HTMLVideoElement seek-and-grab.
  return FallbackVideoSourceDecoder.open(file);
}

/** Maximum number of decoded VideoFrames to hold per source at once. Each
 *  frame holds GPU memory — 1080p ≈ 6MB. 8 frames = ~48MB worst case. */
const FRAME_RING_LIMIT = 8;

class Mp4WebCodecsDecoder implements VideoSourceDecoder {
  private decoder!: VideoDecoder;
  private decoderConfig!: VideoDecoderConfig;
  private readonly timescale: number;
  private readonly samples: Array<{ data: ArrayBuffer; cts: number; dts: number; isSync: boolean; duration: number }> = [];
  private nextSampleIdx = 0;
  /** Decoded frames sorted ascending by source time (seconds). */
  private frames: VideoFrame[] = [];
  private closed = false;
  private decoderError: Error | null = null;
  /** Highest sourceTime we've satisfied. If a caller asks for something
   *  earlier we need to seek back to a keyframe and re-decode forward. */
  private lastServedTime = -Infinity;

  private constructor(timescale: number) {
    this.timescale = timescale;
  }

  static async open(file: File): Promise<Mp4WebCodecsDecoder> {
    const iso = createFile();
    // Hook the callbacks BEFORE feeding bytes — mp4box fires onReady
    // synchronously from appendBuffer once the moov box has been parsed.
    const readyPromise = new Promise<{ id: number; timescale: number; codec: string; codedWidth: number; codedHeight: number; description: Uint8Array }>((resolve, reject) => {
      iso.onError = (e) => reject(new Error(e));
      iso.onReady = (info) => {
        const videoTrack = info.tracks.find((t: Track) => t.type === 'video');
        if (!videoTrack) {
          reject(new Error('No video track in source'));
          return;
        }
        try {
          const description = extractAvcCDescription(iso, videoTrack.id);
          resolve({
            id: videoTrack.id,
            timescale: videoTrack.timescale,
            codec: videoTrack.codec,
            codedWidth: (videoTrack as Track & { video?: { width: number; height: number } }).video?.width ?? 0,
            codedHeight: (videoTrack as Track & { video?: { width: number; height: number } }).video?.height ?? 0,
            description,
          });
        } catch (err) {
          reject(err);
        }
      };
    });

    // Feed the entire file to mp4box. (Streaming would be a micro-optimization;
    // a 100MB MP4 is fine to load fully.)
    const buf = await file.arrayBuffer() as ArrayBuffer & { fileStart?: number };
    (buf as MP4BoxBuffer).fileStart = 0;
    iso.appendBuffer(buf as MP4BoxBuffer);

    const trackInfo = await readyPromise;

    const inst = new Mp4WebCodecsDecoder(trackInfo.timescale);
    inst.decoderConfig = {
      codec: trackInfo.codec,
      codedWidth: trackInfo.codedWidth,
      codedHeight: trackInfo.codedHeight,
      description: trackInfo.description,
    };
    inst.decoder = new VideoDecoder({
      output: (frame) => inst.handleDecodedFrame(frame),
      error: (e) => { inst.decoderError = e instanceof Error ? e : new Error(String(e)); },
    });
    inst.decoder.configure(inst.decoderConfig);

    iso.setExtractionOptions(trackInfo.id, null, { nbSamples: 200 });
    iso.onSamples = (id, _user, samples) => {
      if (id !== trackInfo.id) return;
      for (const s of samples) {
        if (!s.data) continue;
        inst.samples.push({
          data: s.data.buffer.slice(s.data.byteOffset, s.data.byteOffset + s.data.byteLength),
          cts: s.cts,
          dts: s.dts,
          isSync: !!s.is_sync,
          duration: s.duration,
        });
      }
    };
    iso.start();
    iso.flush();
    inst.samples.sort((a, b) => a.dts - b.dts);

    return inst;
  }

  private handleDecodedFrame(frame: VideoFrame): void {
    if (this.closed) {
      frame.close();
      return;
    }
    // Insert sorted by timestamp.
    const ts = frame.timestamp / 1_000_000;
    let i = this.frames.length;
    while (i > 0 && (this.frames[i - 1].timestamp / 1_000_000) > ts) i--;
    this.frames.splice(i, 0, frame);

    // If the ring is overfull, drop the OLDEST. Two cases:
    //   (a) Runaway decode in normal forward play — frameAt should be
    //       closing as it consumes, but this is a belt for that.
    //   (b) After a seek-back, in-flight decodes from the pre-seek path may
    //       still output frames into this array. They have stale timestamps
    //       and get sorted to one end; the overflow drop trims them.
    while (this.frames.length > FRAME_RING_LIMIT * 2) {
      const dropped = this.frames.shift();
      dropped?.close();
    }
  }

  /** Seek to the latest keyframe at or before the given source time.
   *  Resets the decoder, reconfigures, clears frame state, and rewinds
   *  `nextSampleIdx` so the next frameAt() call decodes forward from there. */
  private seekBackTo(sourceTime: number): void {
    const targetCts = sourceTime * this.timescale;
    let kfIdx = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      if (s.cts > targetCts) break;
      if (s.isSync) kfIdx = i;
    }
    try {
      this.decoder.reset();
      this.decoder.configure(this.decoderConfig);
    } catch (e) {
      this.decoderError = e instanceof Error ? e : new Error(String(e));
      return;
    }
    for (const f of this.frames) f.close();
    this.frames = [];
    this.nextSampleIdx = kfIdx;
    this.lastServedTime = -Infinity;
  }

  async frameAt(sourceTime: number): Promise<VideoFrame | null> {
    if (this.closed) return null;
    if (this.decoderError) throw this.decoderError;

    // Seek-back when the caller asks for an earlier time than we've already
    // decoded past. Happens when two clips share the same media but their
    // source ranges are reordered on the timeline. We allow a small slack
    // to absorb floating-point jitter without triggering a re-seek.
    const SLACK = 0.05;
    if (sourceTime < this.lastServedTime - SLACK) {
      this.seekBackTo(sourceTime);
    }

    // Push samples up through the requested time. We over-decode by a few
    // frames so the frame at exactly `sourceTime` is available even with
    // B-frame reordering.
    const targetCts = sourceTime * this.timescale;
    while (
      this.nextSampleIdx < this.samples.length &&
      this.samples[this.nextSampleIdx].dts <= targetCts + this.timescale * 0.5 &&
      this.decoder.decodeQueueSize < FRAME_RING_LIMIT * 2
    ) {
      const s = this.samples[this.nextSampleIdx++];
      this.decoder.decode(new EncodedVideoChunk({
        type: s.isSync ? 'key' : 'delta',
        timestamp: Math.round((s.cts * 1_000_000) / this.timescale),
        duration: Math.round((s.duration * 1_000_000) / this.timescale),
        data: s.data,
      }));
    }

    // Wait for frames to be ready up to (or past) the requested time.
    // Poll briefly — VideoDecoder.output runs on the same event loop.
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) {
      // Close any frames that are older than what we need.
      while (this.frames.length > 1 && (this.frames[1].timestamp / 1_000_000) <= sourceTime) {
        const dropped = this.frames.shift();
        dropped?.close();
      }
      // The current best match is frames[0] if it's at/before sourceTime,
      // and no later frame is at/before sourceTime.
      if (this.frames.length > 0 && (this.frames[0].timestamp / 1_000_000) <= sourceTime) {
        // Ensure at least one more frame is past sourceTime, OR we've hit EOS.
        if (
          this.frames.length > 1 ||
          (this.nextSampleIdx >= this.samples.length && this.decoder.decodeQueueSize === 0)
        ) {
          this.lastServedTime = sourceTime;
          return this.frames[0];
        }
      }
      if (this.decoderError) throw this.decoderError;
      if (this.nextSampleIdx >= this.samples.length && this.decoder.decodeQueueSize === 0) {
        // Reached end of stream.
        this.lastServedTime = sourceTime;
        return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
      }
      // Yield the microtask queue so decoder.output callbacks can fire.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    // Timed out waiting for the decoder. Throwing surfaces this loudly
    // instead of silently encoding 1500ms of stale frames.
    throw new Error(`VideoDecoder timed out waiting for frame at ${sourceTime.toFixed(3)}s`);
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.decoder.flush().catch(() => {});
      this.decoder.close();
    } catch {
      // ignore
    }
    for (const f of this.frames) f.close();
    this.frames = [];
  }
}

/** Extract the avcC box description bytes from a track's sample entry.
 *  WebCodecs' VideoDecoder.configure() expects this for h264. */
function extractAvcCDescription(file: ISOFile, trackId: number): Uint8Array {
  const trak = (file as unknown as { getTrackById: (id: number) => unknown }).getTrackById(trackId) as {
    mdia: { minf: { stbl: { stsd: { entries: VisualSampleEntry[] } } } };
  };
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
  if (!entries) throw new Error('Unable to read sample entries');
  for (const entry of entries) {
    const box = (entry as VisualSampleEntry & { avcC?: { write: (s: DataStream) => void }; hvcC?: { write: (s: DataStream) => void } }).avcC
      ?? (entry as VisualSampleEntry & { hvcC?: { write: (s: DataStream) => void } }).hvcC;
    if (!box) continue;
    const stream = new DataStream();
    box.write(stream);
    // mp4box writes a box header (size+type, 8 bytes) prefix; strip it.
    const bytes = new Uint8Array(stream.buffer);
    return bytes.slice(8);
  }
  throw new Error('No avcC/hvcC sample entry found');
}

/** Fallback: HTMLVideoElement + seek-and-grab. Slow (one seek per output
 *  frame) but works for any browser-playable codec. */
class FallbackVideoSourceDecoder implements VideoSourceDecoder {
  private readonly video: HTMLVideoElement;
  private readonly objectUrl: string;
  private cached: { time: number; frame: VideoFrame } | null = null;

  private constructor(video: HTMLVideoElement, objectUrl: string) {
    this.video = video;
    this.objectUrl = objectUrl;
  }

  static async open(file: File): Promise<FallbackVideoSourceDecoder> {
    if (typeof document === 'undefined') {
      throw new Error('Non-MP4 source detected; HTMLVideoElement fallback unavailable in worker context. Convert the source to MP4 (H.264) and retry.');
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Fallback video failed to load'));
    });
    return new FallbackVideoSourceDecoder(video, url);
  }

  async frameAt(sourceTime: number): Promise<VideoFrame | null> {
    if (Math.abs(this.video.currentTime - sourceTime) > 0.01) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => { this.video.removeEventListener('seeked', onSeeked); resolve(); };
        this.video.addEventListener('seeked', onSeeked);
        this.video.currentTime = sourceTime;
      });
    }
    this.cached?.frame.close();
    const frame = new VideoFrame(this.video, { timestamp: Math.round(sourceTime * 1_000_000) });
    this.cached = { time: sourceTime, frame };
    return frame;
  }

  async close(): Promise<void> {
    this.cached?.frame.close();
    this.cached = null;
    this.video.src = '';
    URL.revokeObjectURL(this.objectUrl);
  }
}
