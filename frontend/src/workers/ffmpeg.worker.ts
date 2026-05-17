/// <reference lib="webworker" />
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { buildExportCommand, type ExportTrack, type QualityPreset } from '../services/filterGraph';
import type { FontFamilyKey, MediaKind } from '../types/project';

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
  mediaKinds: Record<string, MediaKind>;
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
const loadedFonts = new Set<FontFamilyKey>();

const FONT_FILE_BY_FAMILY: Record<FontFamilyKey, string> = {
  sans: 'sans.ttf',
  serif: 'serif.ttf',
  mono: 'mono.ttf',
  display: 'display.ttf',
  handwriting: 'handwriting.ttf',
};

async function ensureFontsLoaded(ff: FFmpeg, families: FontFamilyKey[]): Promise<void> {
  for (const family of families) {
    if (loadedFonts.has(family)) continue;
    const file = FONT_FILE_BY_FAMILY[family];
    if (!file) continue;
    const resp = await fetch(`/fonts/${file}`);
    if (!resp.ok) {
      // Fall back to sans before failing the export.
      if (family !== 'sans') {
        await ensureFontsLoaded(ff, ['sans']);
        const sansBytes = new Uint8Array(await (await fetch('/fonts/sans.ttf')).arrayBuffer());
        await ff.writeFile(file, sansBytes);
        loadedFonts.add(family);
        continue;
      }
      throw new Error(`Failed to load font "${family}": HTTP ${resp.status}`);
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    await ff.writeFile(file, bytes);
    loadedFonts.add(family);
  }
}

/** Best-effort: remove leftover FS entries from a previous (possibly crashed)
 *  export. The FFmpeg singleton survives across messages, so stale `input_*`
 *  or `output.mp4` entries could otherwise interfere with the next run. */
async function cleanupStaleFsEntries(ff: FFmpeg): Promise<void> {
  type DirEntry = { name: string; isDir: boolean };
  let entries: DirEntry[] = [];
  try {
    entries = (await ff.listDir('/')) as DirEntry[];
  } catch {
    return;
  }
  const protect = new Set([
    'text.ttf', 'sans.ttf', 'serif.ttf', 'mono.ttf', 'display.ttf', 'handwriting.ttf',
    '.', '..', 'tmp', 'home', 'dev', 'proc',
  ]);
  for (const entry of entries) {
    if (!entry || entry.isDir) continue;
    if (protect.has(entry.name)) continue;
    await ff.deleteFile(entry.name).catch(() => {});
  }
}

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

    // Wipe any leftover files in FS from a previous, possibly crashed export.
    await cleanupStaleFsEntries(ff);

    // Load each font family referenced by text clips. Throws on failure so the
    // user sees a clear error instead of an opaque drawtext-no-font failure.
    const fontKeys: FontFamilyKey[] = [];
    for (const t of req.tracks) {
      for (const c of t.clips) {
        if (c.kind === 'text' && !fontKeys.includes(c.fontFamily)) {
          fontKeys.push(c.fontFamily);
        }
      }
    }
    if (fontKeys.length > 0) await ensureFontsLoaded(ff, fontKeys);

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
      mediaKinds: req.mediaKinds,
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
