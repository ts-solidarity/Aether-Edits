import type { MediaFile } from '../types/project';

export const EXPORT_FPS = 30;
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

export interface ExportClip {
  mediaId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
}

export interface ExportTrack {
  trackId: string;
  clips: ExportClip[];
}

export type QualityPreset = 'fast' | 'balanced' | 'quality';

export interface BuildExportInput {
  tracks: ExportTrack[];
  mediaInputNames: Record<string, string>;
  mediaHasAudio: Record<string, boolean>;
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
  let maxW = 0;
  let maxH = 0;
  for (const m of mediaFiles) {
    if (m.width > maxW) maxW = m.width;
    if (m.height > maxH) maxH = m.height;
  }
  if (maxW <= 0 || maxH <= 0) return [DEFAULT_W, DEFAULT_H];
  return [even(maxW), even(maxH)];
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

const PRESET_FLAGS: Record<QualityPreset, { preset: string; crf: string }> = {
  fast: { preset: 'ultrafast', crf: '26' },
  balanced: { preset: 'fast', crf: '24' },
  quality: { preset: 'medium', crf: '22' },
};

export function buildExportCommand(input: BuildExportInput): BuiltCommand {
  const { tracks, mediaInputNames, mediaHasAudio, canvas, timelineDuration, quality } = input;
  const [W, H] = canvas;
  const DUR = timelineDuration;

  // First-seen input ordering, mirroring Python behavior.
  const inputOrder = new Map<string, number>();
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!inputOrder.has(clip.mediaId)) {
        inputOrder.set(clip.mediaId, inputOrder.size);
      }
    }
  }

  const inputArgs: string[] = [];
  for (const mediaId of inputOrder.keys()) {
    const name = mediaInputNames[mediaId];
    if (!name) throw new Error(`No input name for media ${mediaId}`);
    inputArgs.push('-i', name);
  }

  const useCount = new Map<string, number>();
  for (const mediaId of inputOrder.keys()) useCount.set(mediaId, 0);
  for (const track of tracks) {
    for (const clip of track.clips) {
      useCount.set(clip.mediaId, (useCount.get(clip.mediaId) ?? 0) + 1);
    }
  }

  const filters: string[] = [];
  filters.push(`color=c=black:s=${W}x${H}:d=${DUR.toFixed(4)}:r=${EXPORT_FPS},format=yuv420p[base]`);

  // split/asplit for reused media.
  const vLabels = new Map<string, string>(); // key: mediaId:useIndex
  const aLabels = new Map<string, string | null>();
  for (const [mediaId, idx] of inputOrder) {
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

  const perMediaSeen = new Map<string, number>();
  for (const mediaId of inputOrder.keys()) perMediaSeen.set(mediaId, 0);

  const videoClipLabels: Array<{ label: string; tlStart: number; tlEnd: number }> = [];
  const audioChains: string[] = [];

  for (const track of tracks) {
    const clipsSorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    for (let i = 0; i < clipsSorted.length; i++) {
      const clip = clipsSorted[i];
      const k = perMediaSeen.get(clip.mediaId) ?? 0;
      perMediaSeen.set(clip.mediaId, k + 1);
      const srcLabel = vLabels.get(`${clip.mediaId}:${k}`);
      if (!srcLabel) throw new Error(`No video label for ${clip.mediaId}:${k}`);

      const srcStart = clip.sourceStart;
      const srcEnd = clip.sourceEnd;
      const tlStart = clip.timelineStart;
      const tlEnd = tlStart + (srcEnd - srcStart);
      const stopPad = Math.max(0, DUR - tlEnd);

      const vidOut = `v_${safeLabel(track.trackId)}_${i}`;
      filters.push(
        `[${srcLabel}]trim=${srcStart.toFixed(4)}:${srcEnd.toFixed(4)},setpts=PTS-STARTPTS,` +
          `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${EXPORT_FPS},` +
          `tpad=start_duration=${tlStart.toFixed(4)}:stop_duration=${stopPad.toFixed(4)}:color=black,` +
          `format=yuv420p[${vidOut}]`
      );
      videoClipLabels.push({ label: vidOut, tlStart, tlEnd });

      const aSrc = aLabels.get(`${clip.mediaId}:${k}`);
      if (aSrc) {
        const audOut = `a_${safeLabel(track.trackId)}_${i}`;
        const parts = [
          `[${aSrc}]atrim=${srcStart.toFixed(4)}:${srcEnd.toFixed(4)}`,
          'asetpts=PTS-STARTPTS',
        ];
        if (tlStart > 0) {
          const delayMs = Math.round(tlStart * 1000);
          parts.push(`adelay=${delayMs}:all=1`);
        }
        filters.push(parts.join(',') + `[${audOut}]`);
        audioChains.push(audOut);
      }
    }
  }

  // Overlay chain: base -> v0 -> v1 -> ... -> outv
  let prev = 'base';
  if (videoClipLabels.length === 0) {
    filters.push('[base]null[outv]');
  } else {
    for (let i = 0; i < videoClipLabels.length; i++) {
      const { label, tlStart, tlEnd } = videoClipLabels[i];
      const out = i === videoClipLabels.length - 1 ? 'outv' : `o${i}`;
      filters.push(
        `[${prev}][${label}]overlay=enable='between(t,${tlStart.toFixed(4)},${tlEnd.toFixed(4)})'[${out}]`
      );
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
    'output.mp4',
  ];

  return { inputArgs, filterComplex, outputArgs };
}
