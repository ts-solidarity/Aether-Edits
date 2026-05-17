import type { ColorAdjust, FontFamilyKey, MediaFile, MediaKind, Transform, VideoFit } from '../types/project';

export const EXPORT_FPS = 30;

export interface ExportVideoClip {
  kind: 'video';
  id: string;
  mediaId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  zIndex: number;
  volume: number;
  muted: boolean;
  pan: number;
  duckSourceClipId: string | null;
  duckAmount: number;
  fit: VideoFit;
  transform: Transform;
  color: ColorAdjust | null;
  speed: number;
  // Transition that fades this clip out at its end. If the next clip on the same
  // track is exactly adjacent and neither is fit='free', the export pipeline pairs
  // the two via xfade/acrossfade. Otherwise this becomes a fade-to-black orphan.
  transitionOut: { kind: import('../types/project').TransitionKind; duration: number } | null;
}

export interface ExportImageClip {
  kind: 'image';
  id: string;
  mediaId: string;
  sourceStart: 0;
  sourceEnd: number;
  timelineStart: number;
  zIndex: number;
  fit: VideoFit;
  transform: Transform;
  color: ColorAdjust | null;
  speed: number; // accepted; image is static so visible duration uses clipDuration math upstream
  transitionOut: { kind: import('../types/project').TransitionKind; duration: number } | null;
}

export interface ExportTextClip {
  kind: 'text';
  id: string;
  text: string;
  color: string; // hex like "#ffffff"
  fontSize: number; // % of canvas height
  fontFamily: FontFamilyKey;
  transform: Transform;
  speed: number;
  timelineStart: number;
  sourceEnd: number;
  sourceStart: number;
  zIndex: number;
}

export type ExportClip = ExportVideoClip | ExportImageClip | ExportTextClip;

export interface ExportTrack {
  trackId: string;
  clips: ExportClip[];
}

export type QualityPreset = 'fast' | 'balanced' | 'quality';

export interface BuildExportInput {
  tracks: ExportTrack[];
  mediaInputNames: Record<string, string>;
  mediaHasAudio: Record<string, boolean>;
  /** Per-media-id kind so the orchestrator can pick the right ffmpeg input args (-loop 1 for images). */
  mediaKinds: Record<string, MediaKind>;
  canvas: [number, number];
  timelineDuration: number;
  quality: QualityPreset;
}

export interface BuiltCommand {
  inputArgs: string[];
  filterComplex: string;
  outputArgs: string[];
}

function even(n: number): number {
  const clamped = Math.max(n, 2);
  return clamped % 2 === 0 ? clamped : clamped + 1;
}

export function computeCanvas(mediaFiles: MediaFile[]): [number, number] {
  // Always produce a 16:9 canvas so the export aspect matches the preview
  // (which is fixed 16:9). Height is picked from the largest source so SD
  // sources don't get unnecessarily upscaled; tiny sources still land at a
  // watchable size.
  let maxH = 0;
  for (const m of mediaFiles) {
    if (m.height > maxH) maxH = m.height;
  }
  const h =
    maxH >= 1080 ? 1080 :
    maxH >= 720 ? 720 :
    maxH > 0 ? Math.max(480, even(maxH)) :
    720;
  const w = even(Math.round((h * 16) / 9));
  return [w, h];
}

export function computeTimelineDuration(tracks: ExportTrack[]): number {
  let end = 0;
  for (const t of tracks) {
    for (const c of t.clips) {
      const clipEnd = c.timelineStart + (c.sourceEnd - c.sourceStart);
      if (clipEnd > end) end = clipEnd;
    }
  }
  return end;
}

function safeLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}

function escapeDrawtext(s: string): string {
  // FFmpeg drawtext: escape backslash, colon, single quote, percent, newline.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, '\\n');
}

function hexToFFmpegColor(hex: string): string {
  // FFmpeg understands "white", "0xRRGGBB", or "#RRGGBB". Accept both.
  if (/^#?[0-9a-fA-F]{6}$/.test(hex)) {
    return hex.startsWith('#') ? `0x${hex.slice(1)}` : `0x${hex}`;
  }
  return 'white';
}

const PRESET_FLAGS: Record<QualityPreset, { preset: string; crf: string }> = {
  fast: { preset: 'ultrafast', crf: '26' },
  balanced: { preset: 'fast', crf: '24' },
  quality: { preset: 'medium', crf: '22' },
};

/** Build the atempo filter chain to achieve a target speed.
 *  atempo accepts factors in [0.5, 2]; we cascade for values outside the range. */
function atempoChain(speed: number): string[] {
  if (Math.abs(speed - 1) < 1e-6) return [];
  const parts: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    parts.push('atempo=2');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-6) parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts;
}

const FONT_FILE_BY_FAMILY: Record<FontFamilyKey, string> = {
  sans: 'sans.ttf',
  serif: 'serif.ttf',
  mono: 'mono.ttf',
  display: 'display.ttf',
  handwriting: 'handwriting.ttf',
};

export function fontFileForFamily(family: FontFamilyKey): string {
  return FONT_FILE_BY_FAMILY[family] ?? FONT_FILE_BY_FAMILY.sans;
}

export function buildExportCommand(input: BuildExportInput): BuiltCommand {
  const { tracks, mediaInputNames, mediaHasAudio, mediaKinds, canvas, timelineDuration, quality } = input;
  const [W, H] = canvas;
  const DUR = timelineDuration;

  // Collect clips by kind. Video and image both feed into the timed-media pipeline
  // (geometry + overlay), but they take different input args and only video has
  // audio.
  const allVideoClips: ExportVideoClip[] = [];
  const allImageClips: ExportImageClip[] = [];
  const allTextClips: { clip: ExportTextClip; trackIndex: number }[] = [];
  tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) {
      if (clip.kind === 'video') allVideoClips.push(clip);
      else if (clip.kind === 'image') allImageClips.push(clip);
      else allTextClips.push({ clip, trackIndex });
    }
  });

  // Input args. Video media are shared (one -i per media, split filter for reuse).
  // Image clips each get their own input with `-loop 1 -t <dur>` so the input has
  // a finite duration matched to the clip's displayed length.
  const videoMediaOrder = new Map<string, number>();
  const imageClipInputIdx = new Map<string, number>();
  const inputArgs: string[] = [];
  for (const clip of allVideoClips) {
    if (videoMediaOrder.has(clip.mediaId)) continue;
    const idx = videoMediaOrder.size + imageClipInputIdx.size;
    videoMediaOrder.set(clip.mediaId, idx);
    const name = mediaInputNames[clip.mediaId];
    if (!name) throw new Error(`No input name for media ${clip.mediaId}`);
    inputArgs.push('-i', name);
  }
  for (const clip of allImageClips) {
    const idx = videoMediaOrder.size + imageClipInputIdx.size;
    imageClipInputIdx.set(clip.id, idx);
    const name = mediaInputNames[clip.mediaId];
    if (!name) throw new Error(`No input name for image ${clip.mediaId}`);
    const speed = Math.max(0.01, clip.speed);
    const dur = (clip.sourceEnd - 0) / speed;
    inputArgs.push('-loop', '1', '-t', dur.toFixed(4), '-i', name);
  }

  // Per-clip video usage count (for split when a single media is reused).
  const useCount = new Map<string, number>();
  for (const mediaId of videoMediaOrder.keys()) useCount.set(mediaId, 0);
  for (const clip of allVideoClips) {
    useCount.set(clip.mediaId, (useCount.get(clip.mediaId) ?? 0) + 1);
  }

  const filters: string[] = [];
  filters.push(`color=c=black:s=${W}x${H}:d=${DUR.toFixed(4)}:r=${EXPORT_FPS},format=yuv420p[base]`);

  // Source labels for video clips: per media:k via split.
  const vLabels = new Map<string, string>();
  const aLabels = new Map<string, string | null>();
  for (const [mediaId, idx] of videoMediaOrder) {
    const count = useCount.get(mediaId) ?? 0;
    if (count <= 1) {
      vLabels.set(`${mediaId}:0`, `${idx}:v`);
      aLabels.set(`${mediaId}:0`, mediaHasAudio[mediaId] ? `${idx}:a` : null);
    } else {
      const vOuts = Array.from({ length: count }, (_, k) => `m${idx}v${k}`);
      filters.push(`[${idx}:v]split=${count}` + vOuts.map((l) => `[${l}]`).join(''));
      vOuts.forEach((l, k) => vLabels.set(`${mediaId}:${k}`, l));
      if (mediaHasAudio[mediaId]) {
        const aOuts = Array.from({ length: count }, (_, k) => `m${idx}a${k}`);
        filters.push(`[${idx}:a]asplit=${count}` + aOuts.map((l) => `[${l}]`).join(''));
        aOuts.forEach((l, k) => aLabels.set(`${mediaId}:${k}`, l));
      } else {
        for (let k = 0; k < count; k++) aLabels.set(`${mediaId}:${k}`, null);
      }
    }
  }
  // Image clips: one input per clip, src is `[idx:v]`. No audio.
  const imageSrcLabel = new Map<string, string>();
  for (const [clipId, idx] of imageClipInputIdx) {
    imageSrcLabel.set(clipId, `${idx}:v`);
  }
  // Silence the unused-mediaKinds variable to keep the build clean even if no
  // image clips are present.
  void mediaKinds;

  const perMediaSeen = new Map<string, number>();
  for (const mediaId of videoMediaOrder.keys()) perMediaSeen.set(mediaId, 0);

  // Index every clip's timeline range (used for duck-source lookup across tracks).
  const clipRange = new Map<string, { tlStart: number; tlEnd: number }>();
  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.kind === 'video') {
        const dur = (c.sourceEnd - c.sourceStart) / Math.max(0.01, c.speed);
        clipRange.set(c.id, { tlStart: c.timelineStart, tlEnd: c.timelineStart + dur });
      } else if (c.kind === 'image') {
        const dur = (c.sourceEnd - 0) / Math.max(0.01, c.speed);
        clipRange.set(c.id, { tlStart: c.timelineStart, tlEnd: c.timelineStart + dur });
      }
    }
  }

  const videoClipLabels: Array<{
    label: string;
    tlStart: number;
    tlEnd: number;
    fit: VideoFit;
    transform: Transform;
    sortKey: [number, number, number]; // [zIndex, trackIndex, tlStart]
  }> = [];
  const audioChains: string[] = [];

  const trackIndexOf = new Map<string, number>();
  tracks.forEach((t, i) => trackIndexOf.set(t.trackId, i));

  // FFmpeg color names per transition kind that need them.
  // (xfade uses 'transition=fadeblack' / 'fadewhite' directly; no extra color arg needed.)

  for (const track of tracks) {
    const sorted = [...track.clips]
      .filter((c): c is ExportVideoClip | ExportImageClip =>
        c.kind === 'video' || c.kind === 'image'
      )
      .sort((a, b) => a.timelineStart - b.timelineStart);

    // Group into runs: A and B share a run iff both are video, A has transitionOut,
    // B is exactly adjacent to A on the timeline, and neither is fit='free'.
    // Image clips always render as singletons (no xfade chaining).
    const ADJ_EPS = 0.005;
    const runs: (ExportVideoClip | ExportImageClip)[][] = [];
    let cur: (ExportVideoClip | ExportImageClip)[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i];
      if (cur.length === 0) {
        cur.push(clip);
        continue;
      }
      const prev = cur[cur.length - 1];
      const prevDur =
        prev.kind === 'image'
          ? prev.sourceEnd / Math.max(0.01, prev.speed)
          : (prev.sourceEnd - prev.sourceStart) / Math.max(0.01, prev.speed);
      const prevEnd = prev.timelineStart + prevDur;
      const adjacent = Math.abs(clip.timelineStart - prevEnd) < ADJ_EPS;
      const chainable =
        prev.kind === 'video' &&
        clip.kind === 'video' &&
        prev.transitionOut !== null &&
        prev.transitionOut.duration > 0 &&
        prev.fit !== 'free' &&
        clip.fit !== 'free' &&
        prev.zIndex === clip.zIndex &&
        adjacent;
      if (chainable) {
        cur.push(clip);
      } else {
        runs.push(cur);
        cur = [clip];
      }
    }
    if (cur.length > 0) runs.push(cur);

    let runIdx = 0;
    for (const run of runs) {
      const sourceTimeLayers: { label: string; dur: number }[] = [];
      const audioSourceLayers: { label: string | null; dur: number }[] = [];
      for (let i = 0; i < run.length; i++) {
        const clip = run[i];
        const speed = Math.max(0.01, clip.speed);
        const rawDur =
          clip.kind === 'image' ? clip.sourceEnd : clip.sourceEnd - clip.sourceStart;
        const dur = rawDur / speed;

        let srcLabel: string;
        if (clip.kind === 'video') {
          const k = perMediaSeen.get(clip.mediaId) ?? 0;
          perMediaSeen.set(clip.mediaId, k + 1);
          const found = vLabels.get(`${clip.mediaId}:${k}`);
          if (!found) throw new Error(`No video label for ${clip.mediaId}:${k}`);
          srcLabel = found;
        } else {
          const found = imageSrcLabel.get(clip.id);
          if (!found) throw new Error(`No image label for ${clip.id}`);
          srcLabel = found;
        }

        // Geometry stage by fit.
        const geometry: string[] = [];
        let layerFormat = 'format=yuv420p';
        if (clip.fit === 'cover') {
          geometry.push(`scale=${W}:${H}:force_original_aspect_ratio=increase`);
          geometry.push(`crop=${W}:${H}`);
        } else if (clip.fit === 'free') {
          const sx = Math.max(0.01, clip.transform.scale);
          geometry.push(`scale=trunc(iw*${sx.toFixed(4)}/2)*2:trunc(ih*${sx.toFixed(4)}/2)*2`);
          layerFormat = 'format=yuva420p';
          if (Math.abs(clip.transform.rotation) > 0.001) {
            const angRad = (clip.transform.rotation * Math.PI) / 180;
            geometry.push(`rotate=${angRad.toFixed(6)}:c=none`);
          }
        } else {
          geometry.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
          geometry.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
        }

        const colorChain: string[] = [];
        if (clip.color) {
          const c = clip.color;
          colorChain.push(
            `eq=brightness=${c.brightness.toFixed(3)}:contrast=${c.contrast.toFixed(3)}:saturation=${c.saturation.toFixed(3)}`
          );
          if (Math.abs(c.hue) > 0.01) colorChain.push(`hue=h=${c.hue.toFixed(1)}`);
        }

        // Singleton-orphan: clip is alone in run AND has transitionOut → fade-to-black.
        const isSingleton = run.length === 1;
        const fades: string[] = [];
        if (isSingleton && clip.transitionOut && clip.transitionOut.duration > 0) {
          const d = Math.min(clip.transitionOut.duration, dur / 2);
          fades.push(`fade=t=out:st=${(dur - d).toFixed(4)}:d=${d.toFixed(4)}`);
        }

        // Video speed: setpts=PTS/speed inside the source-time chain. Image is
        // already shaped by `-t DUR` on its input — no setpts speed needed.
        const speedFilter: string[] =
          clip.kind === 'video' && Math.abs(speed - 1) > 1e-6
            ? [`setpts=PTS/${speed.toFixed(4)}`]
            : [];

        const layerLabel = `vs_${safeLabel(track.trackId)}_${runIdx}_${i}`;
        const head =
          clip.kind === 'video'
            ? [
                `[${srcLabel}]trim=${clip.sourceStart.toFixed(4)}:${clip.sourceEnd.toFixed(4)}`,
                'setpts=PTS-STARTPTS',
                ...speedFilter,
              ]
            : [`[${srcLabel}]setpts=PTS-STARTPTS`];
        const chain = [
          ...head,
          ...geometry,
          ...colorChain,
          `fps=${EXPORT_FPS}`,
          ...fades,
          layerFormat,
        ];
        filters.push(chain.join(',') + `[${layerLabel}]`);
        sourceTimeLayers.push({ label: layerLabel, dur });

        // Audio path: image clips have no audio.
        if (clip.kind === 'image') {
          audioSourceLayers.push({ label: null, dur });
          continue;
        }
        const aSrc = aLabels.get(`${clip.mediaId}:${(perMediaSeen.get(clip.mediaId) ?? 1) - 1}`);
        if (aSrc && !clip.muted && clip.volume > 0) {
          const audLabel = `as_${safeLabel(track.trackId)}_${runIdx}_${i}`;
          const aFades: string[] = [];
          if (isSingleton && clip.transitionOut && clip.transitionOut.duration > 0) {
            const d = Math.min(clip.transitionOut.duration, dur / 2);
            aFades.push(`afade=t=out:st=${(dur - d).toFixed(4)}:d=${d.toFixed(4)}`);
          }

          const panParts: string[] = [];
          if (Math.abs(clip.pan) > 0.001) {
            const p = Math.max(-1, Math.min(1, clip.pan));
            const L = (1 - Math.max(0, p)).toFixed(3);
            const R = (1 + Math.min(0, p)).toFixed(3);
            panParts.push('aformat=channel_layouts=stereo');
            panParts.push(`pan=stereo|c0=${L}*c0|c1=${R}*c1`);
          }

          const duckParts: string[] = [];
          if (clip.duckSourceClipId && clip.duckAmount > 0) {
            const src = clipRange.get(clip.duckSourceClipId);
            if (src) {
              const localStart = Math.max(0, src.tlStart - clip.timelineStart);
              const localEnd = Math.min(dur, src.tlEnd - clip.timelineStart);
              if (localEnd > localStart) {
                const attenuated = (1 - clip.duckAmount).toFixed(3);
                duckParts.push(
                  `volume=eval=frame:volume='if(between(t,${localStart.toFixed(4)},${localEnd.toFixed(4)}),${attenuated},1)'`
                );
              }
            }
          }

          // Speed for audio: atempo chain (cascaded for values outside 0.5..2).
          const tempo = atempoChain(speed);

          const aChain = [
            `[${aSrc}]atrim=${clip.sourceStart.toFixed(4)}:${clip.sourceEnd.toFixed(4)}`,
            'asetpts=PTS-STARTPTS',
            `volume=${clip.volume.toFixed(3)}`,
            ...panParts,
            ...duckParts,
            ...tempo,
            ...aFades,
          ];
          filters.push(aChain.join(',') + `[${audLabel}]`);
          audioSourceLayers.push({ label: audLabel, dur });
        } else {
          audioSourceLayers.push({ label: null, dur });
        }
      }

      // Cascade xfade for video. For run.length === 1 the source layer is the run output.
      // Note: image clips never appear in chained runs (gated above), so accessing
      // `prev.transitionOut` is safe — runs of length > 1 are all video.
      let runVideoLabel = sourceTimeLayers[0].label;
      let runDur = sourceTimeLayers[0].dur;
      for (let i = 1; i < run.length; i++) {
        const prev = run[i - 1];
        const D = Math.min(
          prev.transitionOut!.duration,
          sourceTimeLayers[i - 1].dur,
          sourceTimeLayers[i].dur
        );
        const offset = runDur - D;
        const next = sourceTimeLayers[i];
        const out = `vx_${safeLabel(track.trackId)}_${runIdx}_${i}`;
        filters.push(
          `[${runVideoLabel}][${next.label}]xfade=transition=${prev.transitionOut!.kind}:duration=${D.toFixed(4)}:offset=${offset.toFixed(4)}[${out}]`
        );
        runVideoLabel = out;
        runDur = runDur + next.dur - D;
      }

      // tpad the combined run to the timeline.
      const runTlStart = run[0].timelineStart;
      const runTlEnd = runTlStart + runDur;
      const stopPad = Math.max(0, DUR - runTlEnd);
      const isFreeRun = run.length === 1 && run[0].fit === 'free';
      const tpadColor = isFreeRun ? 'black@0' : 'black';
      const finalLabel = `vr_${safeLabel(track.trackId)}_${runIdx}`;
      // Explicit start_mode=add:stop_mode=add: FFmpeg 6.x defaults to `add`
      // already, but historic versions (and some forks) default to `clone`,
      // which copies the first/last frame into the pad region. Cloned pad
      // frames can bleed visibly during a gap if the overlay's `enable` clause
      // is ever soft-gated. Being explicit removes all doubt.
      filters.push(
        `[${runVideoLabel}]tpad=start_duration=${runTlStart.toFixed(4)}:` +
        `stop_duration=${stopPad.toFixed(4)}:start_mode=add:stop_mode=add:` +
        `color=${tpadColor}[${finalLabel}]`
      );
      videoClipLabels.push({
        label: finalLabel,
        tlStart: runTlStart,
        tlEnd: runTlEnd,
        fit: run[0].fit,
        transform: run[0].transform,
        sortKey: [run[0].zIndex, trackIndexOf.get(track.trackId) ?? 0, runTlStart],
      });

      // Audio cascade. If the entire run has no real audio (every clip muted or
      // zero-volume), skip both the silence synthesis and the cascade — the master
      // anullsrc base stream covers absence, and emitting dangling acrossfade
      // labels here can confuse FFmpeg's filter graph validator.
      const anyRealAudio = audioSourceLayers.some((a) => a.label !== null);
      if (anyRealAudio) {
        // Synthesize silence only for the muted/zero clips inside an otherwise
        // audible run — needed to keep the acrossfade cascade aligned.
        const filledAudio = audioSourceLayers.map((a, i) => {
          if (a.label) return a;
          const silentLabel = `asil_${safeLabel(track.trackId)}_${runIdx}_${i}`;
          filters.push(`anullsrc=r=48000:cl=stereo:d=${a.dur.toFixed(4)}[${silentLabel}]`);
          return { ...a, label: silentLabel };
        });

        let runAudioLabel: string = filledAudio[0].label!;
        let runAudioDur = filledAudio[0].dur;
        for (let i = 1; i < run.length; i++) {
          const prev = run[i - 1];
          const D = Math.min(prev.transitionOut!.duration, runAudioDur, filledAudio[i].dur);
          const out = `ax_${safeLabel(track.trackId)}_${runIdx}_${i}`;
          filters.push(
            `[${runAudioLabel}][${filledAudio[i].label}]acrossfade=duration=${D.toFixed(4)}:curve1=tri:curve2=tri[${out}]`
          );
          runAudioLabel = out;
          runAudioDur = runAudioDur + filledAudio[i].dur - D;
        }

        const finalAudio = `ar_${safeLabel(track.trackId)}_${runIdx}`;
        if (runTlStart > 0) {
          const delayMs = Math.round(runTlStart * 1000);
          filters.push(`[${runAudioLabel}]adelay=${delayMs}:all=1[${finalAudio}]`);
        } else {
          filters.push(`[${runAudioLabel}]anull[${finalAudio}]`);
        }
        audioChains.push(finalAudio);
      }

      runIdx++;
    }
  }

  // Composite chain: merge media (video/image) layers and text overlays into a
  // single sequence sorted by z-order. Each step overlays onto the running
  // accumulator. Sort key: [zIndex, trackIndex, timelineStart].
  type CompositeStep =
    | { kind: 'media'; sortKey: [number, number, number]; label: string; tlStart: number; tlEnd: number; fit: VideoFit; transform: Transform }
    | { kind: 'text'; sortKey: [number, number, number]; clip: ExportTextClip };

  const composites: CompositeStep[] = [];
  for (const v of videoClipLabels) {
    composites.push({ kind: 'media', sortKey: v.sortKey, label: v.label, tlStart: v.tlStart, tlEnd: v.tlEnd, fit: v.fit, transform: v.transform });
  }
  for (const { clip: t, trackIndex } of allTextClips) {
    composites.push({ kind: 'text', sortKey: [t.zIndex, trackIndex, t.timelineStart], clip: t });
  }
  composites.sort((a, b) => {
    for (let i = 0; i < 3; i++) if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    return 0;
  });

  let prev = 'base';
  if (composites.length === 0) {
    filters.push('[base]null[outv]');
  } else {
    for (let i = 0; i < composites.length; i++) {
      const step = composites[i];
      const isLast = i === composites.length - 1;
      const out = isLast ? 'outv' : `o${i}`;

      if (step.kind === 'media') {
        let xy = '0:0';
        if (step.fit === 'free') {
          xy = `(${W}*${step.transform.x.toFixed(4)})-(overlay_w/2):(${H}*${step.transform.y.toFixed(4)})-(overlay_h/2)`;
        }
        filters.push(
          `[${prev}][${step.label}]overlay=${xy}:enable='between(t,${step.tlStart.toFixed(4)},${step.tlEnd.toFixed(4)})'[${out}]`
        );
      } else {
        const t = step.clip;
        const fontSizePx = Math.max(1, Math.round((t.fontSize / 100) * H * t.transform.scale));
        const escaped = escapeDrawtext(t.text);
        const xN = t.transform.x;
        const yN = t.transform.y;
        const textDur = (t.sourceEnd - t.sourceStart) / Math.max(0.01, t.speed);
        const textEnd = t.timelineStart + textDur;
        const enable = `between(t,${t.timelineStart.toFixed(4)},${textEnd.toFixed(4)})`;
        const fontfile = fontFileForFamily(t.fontFamily);

        const drawtext =
          `drawtext=fontfile=${fontfile}:text='${escaped}':fontcolor=${hexToFFmpegColor(t.color)}:` +
          `fontsize=${fontSizePx}:` +
          `x=(W*${xN.toFixed(4)})-text_w/2:y=(H*${yN.toFixed(4)})-text_h/2:` +
          `borderw=2:bordercolor=black@0.6`;

        if (Math.abs(t.transform.rotation) < 0.01) {
          filters.push(`[${prev}]${drawtext}:enable='${enable}'[${out}]`);
        } else {
          const layer = `tx${i}_lyr`;
          const rotated = `tx${i}_rot`;
          const angRad = (t.transform.rotation * Math.PI) / 180;
          filters.push(
            `color=c=black@0:s=${W}x${H}:d=${DUR.toFixed(4)}:r=${EXPORT_FPS},format=yuva420p,` +
              `${drawtext}[${layer}]`
          );
          filters.push(
            `[${layer}]rotate=${angRad.toFixed(6)}:c=none:ow=${W}:oh=${H}[${rotated}]`
          );
          filters.push(
            `[${prev}][${rotated}]overlay=0:0:enable='${enable}'[${out}]`
          );
        }
      }
      prev = out;
    }
  }

  // Audio: always-on anullsrc base; amix all real audio + base.
  filters.push(`anullsrc=r=48000:cl=stereo:d=${DUR.toFixed(4)}[asilent]`);
  const mixInputs = ['asilent', ...audioChains];
  filters.push(
    mixInputs.map((l) => `[${l}]`).join('') +
      `amix=inputs=${mixInputs.length}:duration=first:normalize=0[outa]`
  );

  const filterComplex = filters.join(';');

  const { preset, crf } = PRESET_FLAGS[quality];
  const outputArgs = [
    '-map', '[outv]', '-map', '[outa]',
    '-c:v', 'libx264', '-preset', preset, '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    // Fragmented MP4: write an empty moov atom upfront, then a stream of small
    // moof+mdat fragments. No seek-back required. FFmpeg.wasm's virtual FS is
    // unreliable at the in-place seek-back the default MP4 muxer uses — larger
    // outputs end up as 'mdat size=0, no moov' unplayable files. Fragmented
    // output plays in every modern browser/player and doesn't need finalization.
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'output.mp4',
  ];

  return { inputArgs, filterComplex, outputArgs };
}
