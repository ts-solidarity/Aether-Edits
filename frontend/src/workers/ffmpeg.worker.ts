/// <reference lib="webworker" />
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { buildExportCommand, type ExportTrack, type QualityPreset } from '../services/filterGraph';

export interface ExportFile {
  logicalName: string;
  mediaId: string;
  file: File;
}

export interface ExportRequest {
  type: 'export';
  files: ExportFile[];
  tracks: ExportTrack[];
  mediaInputNames: Record<string, string>;
  mediaHasAudio: Record<string, boolean>;
  probeMediaIds: string[];
  canvas: [number, number];
  timelineDuration: number;
  quality: QualityPreset;
}

export type ExportMessage =
  | { type: 'loading' }
  | { type: 'loaded' }
  | { type: 'probed'; mediaId: string; hasAudio: boolean }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; output: ArrayBuffer }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let ffmpeg: FFmpeg | null = null;
let timelineDuration = 0;
let lastProgress = 0;

async function load(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  ctx.postMessage({ type: 'loading' } satisfies ExportMessage);
  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    const m = /time=(\d+):(\d+):(\d+)\.(\d+)/.exec(message);
    if (m) {
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
      const frac = timelineDuration > 0 ? Math.min(t / timelineDuration, 0.99) : 0;
      if (frac > lastProgress + 0.005) {
        lastProgress = frac;
        ctx.postMessage({ type: 'progress', fraction: frac } satisfies ExportMessage);
      }
    }
  });
  // Wrap the self-hosted core in blob URLs — dynamic import of a raw
  // /ffmpeg/ffmpeg-core.js path is rewritten by Vite (?import suffix) and fails.
  // toBlobURL fetches the bytes and hands back a plain blob: URL that imports cleanly.
  await ffmpeg.load({
    coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
  });
  ctx.postMessage({ type: 'loaded' } satisfies ExportMessage);
  return ffmpeg;
}

async function probeHasAudio(ff: FFmpeg, logicalName: string): Promise<boolean> {
  const lines: string[] = [];
  const handler = ({ message }: { message: string }) => lines.push(message);
  ff.on('log', handler);
  try {
    await ff.exec(['-i', logicalName, '-f', 'null', '-', '-t', '0.1']).catch(() => {});
  } finally {
    ff.off('log', handler);
  }
  return lines.some((l) => /Stream #\d+:\d+.*: Audio/.test(l));
}

ctx.onmessage = async (ev: MessageEvent<ExportRequest>) => {
  const req = ev.data;
  try {
    const ff = await load();
    timelineDuration = req.timelineDuration;
    lastProgress = 0;

    for (const { logicalName, file } of req.files) {
      await ff.writeFile(logicalName, await fetchFile(file));
    }

    const hasAudio: Record<string, boolean> = { ...req.mediaHasAudio };
    for (const mediaId of req.probeMediaIds) {
      const logicalName = req.mediaInputNames[mediaId];
      if (!logicalName) continue;
      const detected = await probeHasAudio(ff, logicalName);
      hasAudio[mediaId] = detected;
      ctx.postMessage({ type: 'probed', mediaId, hasAudio: detected } satisfies ExportMessage);
    }

    const { inputArgs, filterComplex, outputArgs } = buildExportCommand({
      tracks: req.tracks,
      mediaInputNames: req.mediaInputNames,
      mediaHasAudio: hasAudio,
      canvas: req.canvas,
      timelineDuration: req.timelineDuration,
      quality: req.quality,
    });

    await ff.exec([
      ...inputArgs,
      '-filter_complex', filterComplex,
      ...outputArgs,
    ]);

    const data = await ff.readFile('output.mp4');
    const u8 = data as Uint8Array;
    // Copy into a fresh ArrayBuffer so we have a transferable buffer whose type
    // is unambiguously ArrayBuffer (not SharedArrayBuffer).
    const buf = new ArrayBuffer(u8.byteLength);
    new Uint8Array(buf).set(u8);

    for (const { logicalName } of req.files) {
      await ff.deleteFile(logicalName).catch(() => {});
    }
    await ff.deleteFile('output.mp4').catch(() => {});

    ctx.postMessage({ type: 'done', output: buf } satisfies ExportMessage, { transfer: [buf] });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ type: 'error', message } satisfies ExportMessage);
  }
};
