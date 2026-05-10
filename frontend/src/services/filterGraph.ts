import type { ColorAdjust, MediaFile, Transform, VideoFit } from '../types/project';

export const EXPORT_FPS = 30;
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

export interface ExportVideoClip {
  kind: 'video';
  id: string;
  mediaId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  volume: number;
  muted: boolean;
  pan: number;
  duckSourceClipId: string | null;
  duckAmount: number;
  fit: VideoFit;
  transform: Transform;
  color: ColorAdjust | null;
  // Transition that fades this clip out at its end. If the next clip on the same
  // track is exactly adjacent and neither is fit='free', the export pipeline pairs
  // the two via xfade/acrossfade. Otherwise this becomes a fade-to-black orphan.
  transitionOut: { kind: import('../types/project').TransitionKind; duration: number } | null;
}

export interface ExportTextClip {
  kind: 'text';
  id: string;
  text: string;
  color: string; // hex like "#ffffff"
  fontSize: number; // % of canvas height
  transform: Transform;
  timelineStart: number;
  sourceEnd: number;
  sourceStart: number;
}

export type ExportClip = ExportVideoClip | ExportTextClip;

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

export function buildExportCommand(input: BuildExportInput): BuiltCommand {
  const { tracks, mediaInputNames, mediaHasAudio, canvas, timelineDuration, quality } = input;
  const [W, H] = canvas;
  const DUR = timelineDuration;

  // Collect video clips (for input assignment) and text clips separately.
  const allVideoClips: ExportVideoClip[] = [];
  const allTextClips: ExportTextClip[] = [];
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'video') allVideoClips.push(clip);
      else allTextClips.push(clip);
    }
  }

  // First-seen input ordering for video media.
  const inputOrder = new Map<string, number>();
  for (const clip of allVideoClips) {
    if (!inputOrder.has(clip.mediaId)) inputOrder.set(clip.mediaId, inputOrder.size);
  }

  const inputArgs: string[] = [];
  for (const mediaId of inputOrder.keys()) {
    const name = mediaInputNames[mediaId];
    if (!name) throw new Error(`No input name for media ${mediaId}`);
    inputArgs.push('-i', name);
  }

  const useCount = new Map<string, number>();
  for (const mediaId of inputOrder.keys()) useCount.set(mediaId, 0);
  for (const clip of allVideoClips) {
    useCount.set(clip.mediaId, (useCount.get(clip.mediaId) ?? 0) + 1);
  }

  const filters: string[] = [];
  filters.push(`color=c=black:s=${W}x${H}:d=${DUR.toFixed(4)}:r=${EXPORT_FPS},format=yuv420p[base]`);

  const vLabels = new Map<string, string>();
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

  // Index every clip's timeline range so duck-source lookup works across tracks.
  const clipRange = new Map<string, { tlStart: number; tlEnd: number }>();
  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.kind === 'video') {
        clipRange.set(c.id, {
          tlStart: c.timelineStart,
          tlEnd: c.timelineStart + (c.sourceEnd - c.sourceStart),
        });
      }
    }
  }

  const videoClipLabels: Array<{
    label: string;
    tlStart: number;
    tlEnd: number;
    fit: VideoFit;
    transform: Transform;
  }> = [];
  const audioChains: string[] = [];

  // FFmpeg color names per transition kind that need them.
  // (xfade uses 'transition=fadeblack' / 'fadewhite' directly; no extra color arg needed.)

  for (const track of tracks) {
    const sorted = [...track.clips]
      .filter((c): c is ExportVideoClip => c.kind === 'video')
      .sort((a, b) => a.timelineStart - b.timelineStart);

    // Group into runs: A and B share a run if A has transitionOut, B is exactly
    // adjacent to A on the timeline, and neither is fit='free' (xfade requires
    // matching layer dimensions, and free-fit layers are non-canvas-sized).
    const ADJ_EPS = 0.005;
    const runs: ExportVideoClip[][] = [];
    let cur: ExportVideoClip[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const clip = sorted[i];
      if (cur.length === 0) {
        cur.push(clip);
        continue;
      }
      const prev = cur[cur.length - 1];
      const prevEnd = prev.timelineStart + (prev.sourceEnd - prev.sourceStart);
      const adjacent = Math.abs(clip.timelineStart - prevEnd) < ADJ_EPS;
      const chainable =
        prev.transitionOut !== null &&
        prev.transitionOut.duration > 0 &&
        prev.fit !== 'free' &&
        clip.fit !== 'free' &&
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
      // Build each clip's source-time chain (no tpad, no per-clip fade — xfade handles).
      // Returns the output label and the clip's per-clip duration.
      const sourceTimeLayers: { label: string; dur: number }[] = [];
      const audioSourceLayers: { label: string | null; dur: number; volume: number; muted: boolean }[] = [];
      for (let i = 0; i < run.length; i++) {
        const clip = run[i];
        const k = perMediaSeen.get(clip.mediaId) ?? 0;
        perMediaSeen.set(clip.mediaId, k + 1);
        const srcLabel = vLabels.get(`${clip.mediaId}:${k}`);
        if (!srcLabel) throw new Error(`No video label for ${clip.mediaId}:${k}`);

        const dur = clip.sourceEnd - clip.sourceStart;

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
            // Default ow/oh = rotw(a)/roth(a) — i.e. the bbox; let rotate compute it.
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

        const layerLabel = `vs_${safeLabel(track.trackId)}_${runIdx}_${i}`;
        const chain = [
          `[${srcLabel}]trim=${clip.sourceStart.toFixed(4)}:${clip.sourceEnd.toFixed(4)}`,
          'setpts=PTS-STARTPTS',
          ...geometry,
          ...colorChain,
          `fps=${EXPORT_FPS}`,
          ...fades,
          layerFormat,
        ];
        filters.push(chain.join(',') + `[${layerLabel}]`);
        sourceTimeLayers.push({ label: layerLabel, dur });

        // Audio source-time chain (no adelay; that happens after the run is assembled).
        const aSrc = aLabels.get(`${clip.mediaId}:${k}`);
        if (aSrc && !clip.muted && clip.volume > 0) {
          const audLabel = `as_${safeLabel(track.trackId)}_${runIdx}_${i}`;
          const aFades: string[] = [];
          if (isSingleton && clip.transitionOut && clip.transitionOut.duration > 0) {
            const d = Math.min(clip.transitionOut.duration, dur / 2);
            aFades.push(`afade=t=out:st=${(dur - d).toFixed(4)}:d=${d.toFixed(4)}`);
          }

          // Pan: linear stereo balance. p=-1 → only left, p=+1 → only right, p=0 → unchanged.
          // Force stereo first so `c1` is always defined even for mono sources.
          const panParts: string[] = [];
          if (Math.abs(clip.pan) > 0.001) {
            const p = Math.max(-1, Math.min(1, clip.pan));
            const L = (1 - Math.max(0, p)).toFixed(3);
            const R = (1 + Math.min(0, p)).toFixed(3);
            panParts.push('aformat=channel_layouts=stereo');
            panParts.push(`pan=stereo|c0=${L}*c0|c1=${R}*c1`);
          }

          // Duck: step-function attenuation while the source clip is on the timeline.
          // We express this in clip-local time (source-time chain runs t=0..dur).
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

          const aChain = [
            `[${aSrc}]atrim=${clip.sourceStart.toFixed(4)}:${clip.sourceEnd.toFixed(4)}`,
            'asetpts=PTS-STARTPTS',
            `volume=${clip.volume.toFixed(3)}`,
            ...panParts,
            ...duckParts,
            ...aFades,
          ];
          filters.push(aChain.join(',') + `[${audLabel}]`);
          audioSourceLayers.push({ label: audLabel, dur, volume: clip.volume, muted: clip.muted });
        } else {
          audioSourceLayers.push({ label: null, dur, volume: clip.volume, muted: clip.muted });
        }
      }

      // Cascade xfade for video. For run.length === 1 the source layer is the run output.
      let runVideoLabel = sourceTimeLayers[0].label;
      let runDur = sourceTimeLayers[0].dur;
      for (let i = 1; i < run.length; i++) {
        const prev = run[i - 1];
        const D = Math.min(prev.transitionOut!.duration, run[i - 1].sourceEnd - run[i - 1].sourceStart, run[i].sourceEnd - run[i].sourceStart);
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
      filters.push(
        `[${runVideoLabel}]tpad=start_duration=${runTlStart.toFixed(4)}:stop_duration=${stopPad.toFixed(4)}:color=${tpadColor}[${finalLabel}]`
      );
      videoClipLabels.push({
        label: finalLabel,
        tlStart: runTlStart,
        tlEnd: runTlEnd,
        fit: run[0].fit,
        transform: run[0].transform,
      });

      // Cascade audio: acrossfade for runs, plain concat-via-acrossfade for any pair
      // with a transitionOut (audio always crossfades smoothly during a visual transition).
      // Filter out null (muted/silent) entries — pair them with anullsrc of equal duration
      // so cascading still works. Simpler approach: if any clip in the run has null audio,
      // synthesize a silent stream of that length first.
      const filledAudio = audioSourceLayers.map((a, i) => {
        if (a.label) return a;
        // Synthesize silence for the same duration so the run audio cascade stays aligned.
        const silentLabel = `asil_${safeLabel(track.trackId)}_${runIdx}_${i}`;
        filters.push(`anullsrc=r=48000:cl=stereo:d=${a.dur.toFixed(4)}[${silentLabel}]`);
        return { ...a, label: silentLabel };
      });

      let runAudioLabel: string | null = filledAudio[0].label;
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

      // Skip emitting audio if all clips were muted and we synthesized only silence.
      const anyRealAudio = audioSourceLayers.some((a) => a.label !== null);
      if (anyRealAudio && runAudioLabel) {
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

  // Overlay chain: base → each video clip → then text overlays → [outv].
  let prev = 'base';
  if (videoClipLabels.length === 0) {
    filters.push('[base]null[outv_mid]');
    prev = 'outv_mid';
  } else {
    for (let i = 0; i < videoClipLabels.length; i++) {
      const { label, tlStart, tlEnd, fit, transform } = videoClipLabels[i];
      const isLast = i === videoClipLabels.length - 1;
      const out = isLast && allTextClips.length === 0 ? 'outv' : isLast ? 'outv_mid' : `o${i}`;
      let xy = '0:0';
      if (fit === 'free') {
        // Center the (post-rotate) layer at (W*x_norm, H*y_norm).
        xy = `(${W}*${transform.x.toFixed(4)})-(overlay_w/2):(${H}*${transform.y.toFixed(4)})-(overlay_h/2)`;
      }
      filters.push(
        `[${prev}][${label}]overlay=${xy}:enable='between(t,${tlStart.toFixed(4)},${tlEnd.toFixed(4)})'[${out}]`
      );
      prev = out;
    }
  }

  // Text overlays: each clip emits a chain that produces [txN_overlay], then composites onto the running base.
  if (allTextClips.length > 0) {
    const sortedText = [...allTextClips].sort((a, b) => a.timelineStart - b.timelineStart);
    for (let i = 0; i < sortedText.length; i++) {
      const t = sortedText[i];
      const isLastText = i === sortedText.length - 1;
      const baseLabel = prev;
      const composed = isLastText ? 'outv' : `tx${i}`;

      // Effective fontsize accounts for transform.scale.
      const fontSizePx = Math.max(1, Math.round((t.fontSize / 100) * H * t.transform.scale));
      const escaped = escapeDrawtext(t.text);
      const xN = t.transform.x;
      const yN = t.transform.y;
      const textEnd = t.timelineStart + (t.sourceEnd - t.sourceStart);
      const enable = `between(t,${t.timelineStart.toFixed(4)},${textEnd.toFixed(4)})`;

      const drawtext =
        `drawtext=fontfile=text.ttf:text='${escaped}':fontcolor=${hexToFFmpegColor(t.color)}:` +
        `fontsize=${fontSizePx}:` +
        `x=(W*${xN.toFixed(4)})-text_w/2:y=(H*${yN.toFixed(4)})-text_h/2:` +
        `borderw=2:bordercolor=black@0.6`;

      if (Math.abs(t.transform.rotation) < 0.01) {
        // No rotation: drawtext directly onto running base, gated by enable=.
        filters.push(`[${baseLabel}]${drawtext}:enable='${enable}'[${composed}]`);
      } else {
        // Rotation: render text onto a transparent canvas-sized layer, rotate it, overlay.
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
          `[${baseLabel}][${rotated}]overlay=0:0:enable='${enable}'[${composed}]`
        );
      }
      prev = composed;
    }
  } else if (prev === 'outv_mid') {
    filters.push('[outv_mid]null[outv]');
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
