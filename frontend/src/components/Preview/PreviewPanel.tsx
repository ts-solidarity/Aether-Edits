import { useRef, useEffect, useCallback, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { Clip, ImageClip, ProjectState, TextClip, Transform, VideoClip } from '../../types/project';
import { FONT_FAMILIES, clipDuration } from '../../types/project';
import { CanvasOverlay, type PendingTransform } from './CanvasOverlay';

const ACTIVE_WINDOW_SECONDS = 3;
const ADJACENCY_EPS = 0.01;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTimelineDuration(clips: Record<string, Clip>): number {
  let max = 0;
  for (const clip of Object.values(clips)) {
    const end = clip.timelineStart + clipDuration(clip);
    if (end > max) max = end;
  }
  return max;
}

/** All clips active at time t, in trackOrder ascending (bottom → top). */
function findActiveClipsAtTime(state: ProjectState, time: number): Clip[] {
  const out: Clip[] = [];
  for (const trackId of state.trackOrder) {
    const track = state.tracks[trackId];
    if (!track) continue;
    for (const clipId of track.clips) {
      const clip = state.clips[clipId];
      if (!clip) continue;
      const end = clip.timelineStart + clipDuration(clip);
      if (time >= clip.timelineStart && time < end) out.push(clip);
    }
  }
  return out;
}

/** The immediately previous clip on the same track (by timelineStart order), if any. */
function prevClipOnTrack(state: ProjectState, clip: Clip): Clip | null {
  const track = state.tracks[clip.trackId];
  if (!track) return null;
  const sorted = track.clips
    .map((cid) => state.clips[cid])
    .filter((c): c is Clip => Boolean(c))
    .sort((a, b) => a.timelineStart - b.timelineStart);
  const idx = sorted.findIndex((c) => c.id === clip.id);
  return idx > 0 ? sorted[idx - 1] : null;
}

/** Alpha multiplier for a clip at time t, based on fade-in (from prev transitionOut) and
 *  fade-out (from own transitionOut). Matches FFmpeg: fades live in the last/first D/2 of clip. */
function computeClipAlpha(state: ProjectState, clip: Clip, t: number): number {
  let alpha = 1;
  const dur = clipDuration(clip);
  const tlEnd = clip.timelineStart + dur;

  if (clip.transitionOut && clip.transitionOut.duration > 0) {
    const D = Math.min(clip.transitionOut.duration, dur);
    const halfD = D / 2;
    const fadeStart = tlEnd - halfD;
    if (t >= fadeStart && t < tlEnd) {
      alpha *= Math.max(0, (tlEnd - t) / halfD);
    }
  }

  const prev = prevClipOnTrack(state, clip);
  if (prev && prev.transitionOut && prev.transitionOut.duration > 0) {
    const prevEnd = prev.timelineStart + clipDuration(prev);
    if (Math.abs(prevEnd - clip.timelineStart) < ADJACENCY_EPS) {
      const D = Math.min(prev.transitionOut.duration, dur);
      const halfD = D / 2;
      const fadeInEnd = clip.timelineStart + halfD;
      if (t >= clip.timelineStart && t < fadeInEnd) {
        alpha *= Math.max(0, (t - clip.timelineStart) / halfD);
      }
    }
  }

  return Math.max(0, Math.min(1, alpha));
}

/** CSS filter string approximating FFmpeg `eq` + `hue` for live preview.
 *  Note: CSS brightness is multiplicative (1+b), FFmpeg eq=brightness=b is additive.
 *  We use 1+b as the closest visual approximation; expect minor tone differences vs. export. */
function colorAdjustToCssFilter(c: VideoClip['color']): string {
  if (!c) return 'none';
  return `brightness(${(1 + c.brightness).toFixed(3)}) contrast(${c.contrast.toFixed(3)}) saturate(${c.saturation.toFixed(3)}) hue-rotate(${c.hue.toFixed(1)}deg)`;
}

/** Draw a video clip into the canvas with letterbox / cover / free transform.
 *  - 'contain': preserve aspect, center, letterbox excess (current default).
 *  - 'cover': preserve aspect, center, crop excess.
 *  - 'free': apply transform.x/y/scale/rotation around clip center; base size = letterbox-fit.
 *  Color adjust (if any) is applied via ctx.filter for the duration of the draw.
 */
function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: VideoClip,
  w: number,
  h: number,
  transformOverride?: Transform
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const filter = colorAdjustToCssFilter(clip.color);
  const restoreFilter = filter !== 'none';
  if (restoreFilter) ctx.filter = filter;

  if (clip.fit === 'cover') {
    const k = Math.max(w / vw, h / vh);
    const dw = vw * k;
    const dh = vh * k;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else if (clip.fit === 'free') {
    const t = transformOverride ?? clip.transform;
    const baseK = Math.min(w / vw, h / vh);
    const k = baseK * t.scale;
    const dw = vw * k;
    const dh = vh * k;
    ctx.save();
    ctx.translate(t.x * w, t.y * h);
    if (t.rotation !== 0) ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    // 'contain' — letterbox.
    const scale = Math.min(w / vw, h / vh);
    const dw = Math.round(vw * scale);
    const dh = Math.round(vh * scale);
    const dx = Math.floor((w - dw) / 2);
    const dy = Math.floor((h - dh) / 2);
    ctx.drawImage(video, dx, dy, dw, dh);
  }

  if (restoreFilter) ctx.filter = 'none';
}

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: TextClip,
  w: number,
  h: number,
  transformOverride?: Transform
): void {
  const t = transformOverride ?? clip.transform;
  const fontSizePx = Math.round((clip.fontSize / 100) * h * t.scale);
  if (fontSizePx < 1) return;

  const family = FONT_FAMILIES.find((f) => f.key === clip.fontFamily)?.cssStack ??
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  ctx.save();
  ctx.translate(t.x * w, t.y * h);
  if (t.rotation !== 0) ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.font = `700 ${fontSizePx}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, Math.round(fontSizePx / 24));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.strokeText(clip.text, 0, 0);
  ctx.fillStyle = clip.color;
  ctx.fillText(clip.text, 0, 0);
  ctx.restore();
}

/** Draw an image clip — same fit/transform model as drawVideoClip, but the
 *  source is an HTMLImageElement. */
function drawImageClip(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  clip: ImageClip,
  w: number,
  h: number,
  transformOverride?: Transform
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih || !img.complete) return;

  const filter = clip.color
    ? `brightness(${(1 + clip.color.brightness).toFixed(3)}) contrast(${clip.color.contrast.toFixed(3)}) saturate(${clip.color.saturation.toFixed(3)}) hue-rotate(${clip.color.hue.toFixed(1)}deg)`
    : 'none';
  const restoreFilter = filter !== 'none';
  if (restoreFilter) ctx.filter = filter;

  if (clip.fit === 'cover') {
    const k = Math.max(w / iw, h / ih);
    const dw = iw * k;
    const dh = ih * k;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } else if (clip.fit === 'free') {
    const t = transformOverride ?? clip.transform;
    const baseK = Math.min(w / iw, h / ih);
    const k = baseK * t.scale;
    const dw = iw * k;
    const dh = ih * k;
    ctx.save();
    ctx.translate(t.x * w, t.y * h);
    if (t.rotation !== 0) ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    const scale = Math.min(w / iw, h / ih);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const dx = Math.floor((w - dw) / 2);
    const dy = Math.floor((h - dh) / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  if (restoreFilter) ctx.filter = 'none';
}

export function PreviewPanel() {
  const { state, dispatch } = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  // Image refs are keyed by mediaFileId because the same image media can back
  // multiple clips. Decoding once and reusing across clips saves memory.
  const imageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const primedClipsRef = useRef<Set<string>>(new Set());
  const playingClipsRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [videoLoadTick, setVideoLoadTick] = useState(0);

  // Live transform during drag — bypasses dispatch so a pointermove storm
  // doesn't fill the 50-slot history. Committed once on pointerup.
  const [pendingTransform, setPendingTransform] = useState<PendingTransform | null>(null);
  const pendingTransformRef = useRef<PendingTransform | null>(null);
  pendingTransformRef.current = pendingTransform;

  // When the user double-clicks a text clip we hide its canvas-rendered text
  // and let CanvasOverlay show an inline input instead. Cleared on blur/Enter.
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const editingTextIdRef = useRef<string | null>(null);
  editingTextIdRef.current = editingTextId;

  // Wrapper size = the largest box that fits the available preview area while
  // preserving the project's canvas aspect ratio. JS-driven because CSS can't
  // do "aspect-ratio capped by both max-width and max-height" cleanly across
  // arbitrary aspects.
  const containerRef = useRef<HTMLDivElement>(null);
  const [wrapperSize, setWrapperSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const recompute = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const W = Math.max(0, el.clientWidth - padX);
      const H = Math.max(0, el.clientHeight - padY);
      if (W <= 0 || H <= 0) return;
      const aspect = state.canvas.width / Math.max(1, state.canvas.height);
      let w = W;
      let h = W / aspect;
      if (h > H) {
        h = H;
        w = H * aspect;
      }
      setWrapperSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.canvas.width, state.canvas.height]);

  const hasClips = Object.keys(state.clips).length > 0;
  const totalDuration = getTimelineDuration(state.clips);

  useEffect(() => {
    const current = videoRefs.current;
    const aliveVideoIds = new Set<string>();
    for (const [cid, c] of Object.entries(state.clips)) {
      if (c.kind === 'video') aliveVideoIds.add(cid);
    }
    for (const clipId of Array.from(current.keys())) {
      if (!aliveVideoIds.has(clipId)) {
        const v = current.get(clipId);
        if (v) {
          v.pause();
          v.removeAttribute('src');
          v.load();
        }
        current.delete(clipId);
        primedClipsRef.current.delete(clipId);
      }
    }
    for (const clipId of aliveVideoIds) {
      if (!current.has(clipId)) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.addEventListener('loadeddata', () => setVideoLoadTick((n) => n + 1));
        current.set(clipId, v);
      }
    }
  }, [state.clips]);

  // Image pool — one HTMLImageElement per image media. Cleared when no clip
  // references the media anymore.
  useEffect(() => {
    const current = imageRefs.current;
    const aliveMediaIds = new Set<string>();
    for (const c of Object.values(state.clips)) {
      if (c.kind === 'image') aliveMediaIds.add(c.mediaFileId);
    }
    for (const mediaId of Array.from(current.keys())) {
      if (!aliveMediaIds.has(mediaId)) current.delete(mediaId);
    }
    for (const mediaId of aliveMediaIds) {
      if (current.has(mediaId)) continue;
      const media = state.mediaFiles[mediaId];
      if (!media?.objectUrl) continue;
      const img = new Image();
      img.onload = () => setVideoLoadTick((n) => n + 1);
      img.src = media.objectUrl;
      current.set(mediaId, img);
    }
  }, [state.clips, state.mediaFiles]);

  useEffect(() => {
    for (const [clipId, v] of videoRefs.current) {
      const clip = state.clips[clipId];
      if (!clip || clip.kind !== 'video') continue;
      const media = state.mediaFiles[clip.mediaFileId];
      if (!media?.objectUrl) {
        if (v.src) {
          v.removeAttribute('src');
          v.load();
        }
        continue;
      }
      const clipStart = clip.timelineStart;
      const clipEnd = clipStart + clipDuration(clip);
      const inWindow =
        clipEnd >= state.playheadPosition - ACTIVE_WINDOW_SECONDS &&
        clipStart <= state.playheadPosition + ACTIVE_WINDOW_SECONDS;
      if (inWindow) {
        if (v.src !== media.objectUrl) {
          v.src = media.objectUrl;
          primedClipsRef.current.delete(clipId);
        }
      } else if (v.src) {
        v.removeAttribute('src');
        v.load();
        primedClipsRef.current.delete(clipId);
      }
    }
  }, [state.clips, state.mediaFiles, state.playheadPosition]);

  const drawBlack = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // Still-frame (paused): seek each active VIDEO clip, then composite bottom→top with alpha + text.
  useEffect(() => {
    if (!hasClips || state.isPlaying) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const active = findActiveClipsAtTime(state, state.playheadPosition);
    if (active.length === 0) {
      drawBlack();
      return;
    }

    let cancelled = false;
    const pending: Array<{ v: HTMLVideoElement; handler: () => void; type: 'seeked' | 'loadedmetadata' }> = [];

    const render = async () => {
      for (const clip of active) {
        if (clip.kind !== 'video') continue;
        const v = videoRefs.current.get(clip.id);
        if (!v || !v.src) continue;
        const speed = Math.max(0.25, Math.min(4, clip.speed));
        const src = clip.sourceStart + (state.playheadPosition - clip.timelineStart) * speed;
        if (v.readyState < 1) {
          await new Promise<void>((resolve) => {
            const handler = () => resolve();
            v.addEventListener('loadedmetadata', handler, { once: true });
            pending.push({ v, handler, type: 'loadedmetadata' });
          });
          if (cancelled) return;
        }
        const primed = primedClipsRef.current.has(clip.id);
        const needsSeek = !primed || Math.abs(v.currentTime - src) > 0.05;
        if (needsSeek) {
          await new Promise<void>((resolve) => {
            const handler = () => resolve();
            v.addEventListener('seeked', handler, { once: true });
            pending.push({ v, handler, type: 'seeked' });
            if (!primed && Math.abs(v.currentTime - src) < 0.001) {
              v.currentTime = Math.max(0, src + 0.001);
            } else {
              v.currentTime = src;
            }
          });
          if (cancelled) return;
          primedClipsRef.current.add(clip.id);
        }
      }

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const pt = pendingTransformRef.current;
      for (const clip of active) {
        const alpha = computeClipAlpha(state, clip, state.playheadPosition);
        if (alpha <= 0.001) continue;
        ctx.globalAlpha = alpha;
        const override = pt && pt.clipId === clip.id ? pt.transform : undefined;
        if (clip.kind === 'video') {
          const v = videoRefs.current.get(clip.id);
          if (v && v.readyState >= 2) drawVideoClip(ctx, v, clip, canvas.width, canvas.height, override);
        } else if (clip.kind === 'image') {
          const img = imageRefs.current.get(clip.mediaFileId);
          if (img) drawImageClip(ctx, img, clip, canvas.width, canvas.height, override);
        } else {
          if (editingTextIdRef.current === clip.id) continue;
          drawTextClip(ctx, clip as TextClip, canvas.width, canvas.height, override);
        }
      }
      ctx.globalAlpha = 1;
    };

    render();

    return () => {
      cancelled = true;
      for (const { v, handler, type } of pending) {
        v.removeEventListener(type, handler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClips, state.isPlaying, state.playheadPosition, state.clips, state.mediaFiles, videoLoadTick, pendingTransform]);

  // Playback loop: let each active clip's <video> play; canvas paints per frame.
  useEffect(() => {
    if (!hasClips || !state.isPlaying) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    lastTimeRef.current = 0;

    const render = (timestamp: number) => {
      const delta = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = timestamp;
      const snapshot = stateRef.current;
      const t = snapshot.playheadPosition + delta;
      if (t >= totalDuration) {
        dispatch({ type: 'SET_PLAYING', payload: false });
        dispatch({ type: 'SET_PLAYHEAD', payload: totalDuration });
        return;
      }
      dispatch({ type: 'SET_PLAYHEAD', payload: t });

      const active = findActiveClipsAtTime(snapshot, t);
      const activeIds = new Set(active.map((c) => c.id));

      for (const clipId of Array.from(playingClipsRef.current)) {
        if (!activeIds.has(clipId)) {
          const v = videoRefs.current.get(clipId);
          if (v) {
            if (!v.paused) v.pause();
            v.muted = true;
          }
          playingClipsRef.current.delete(clipId);
        }
      }

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const pt = pendingTransformRef.current;
      for (const clip of active) {
        const alpha = computeClipAlpha(snapshot, clip, t);
        if (alpha <= 0.001) continue;

        if (clip.kind === 'video') {
          const v = videoRefs.current.get(clip.id);
          if (!v || !v.src) continue;
          const videoClip = clip as VideoClip;
          const speed = Math.max(0.25, Math.min(4, videoClip.speed));
          // Source-time advances at `speed` × timeline rate.
          const expectedSrc = videoClip.sourceStart + (t - videoClip.timelineStart) * speed;

          if (!playingClipsRef.current.has(clip.id)) {
            if (v.readyState >= 1) v.currentTime = expectedSrc;
            v.muted = videoClip.muted;
            v.volume = videoClip.volume * alpha;
            v.playbackRate = speed;
            v.play().catch(() => {
              v.muted = true;
              v.play().catch(() => {});
            });
            playingClipsRef.current.add(clip.id);
          } else {
            if (Math.abs(v.currentTime - expectedSrc) > 0.3) v.currentTime = expectedSrc;
            v.muted = videoClip.muted;
            v.volume = Math.max(0, Math.min(1, videoClip.volume * alpha));
            if (Math.abs(v.playbackRate - speed) > 0.01) v.playbackRate = speed;
          }

          if (v.readyState >= 2) {
            ctx.globalAlpha = alpha;
            const override = pt && pt.clipId === clip.id ? pt.transform : undefined;
            drawVideoClip(ctx, v, videoClip, canvas.width, canvas.height, override);
          }
        } else if (clip.kind === 'image') {
          const img = imageRefs.current.get(clip.mediaFileId);
          if (img) {
            ctx.globalAlpha = alpha;
            const override = pt && pt.clipId === clip.id ? pt.transform : undefined;
            drawImageClip(ctx, img, clip, canvas.width, canvas.height, override);
          }
        } else {
          if (editingTextIdRef.current === clip.id) continue;
          ctx.globalAlpha = alpha;
          const override = pt && pt.clipId === clip.id ? pt.transform : undefined;
          drawTextClip(ctx, clip as TextClip, canvas.width, canvas.height, override);
        }
      }
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
      for (const clipId of playingClipsRef.current) {
        const v = videoRefs.current.get(clipId);
        if (v) {
          if (!v.paused) v.pause();
          v.muted = true;
        }
      }
      playingClipsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClips, state.isPlaying, totalDuration]);

  const togglePlay = () => {
    if (!hasClips) return;
    if (state.playheadPosition >= totalDuration) {
      dispatch({ type: 'SET_PLAYHEAD', payload: 0 });
    }
    dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying });
  };

  const skipToStart = () => {
    if (state.isPlaying) dispatch({ type: 'SET_PLAYING', payload: false });
    dispatch({ type: 'SET_PLAYHEAD', payload: 0 });
  };

  const skipToEnd = () => {
    if (state.isPlaying) dispatch({ type: 'SET_PLAYING', payload: false });
    dispatch({ type: 'SET_PLAYHEAD', payload: totalDuration });
  };

  const activeClips = hasClips ? findActiveClipsAtTime(state, state.playheadPosition) : [];

  const [canvasCtx, setCanvasCtx] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!canvasCtx) return;
    const onClick = () => setCanvasCtx(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [canvasCtx]);

  return (
    <div className="preview-panel">
      <div className="preview-canvas-container" ref={containerRef}>
        {hasClips ? (
          <div
            className="preview-canvas-wrapper"
            style={{ width: wrapperSize.w || undefined, height: wrapperSize.h || undefined }}
            onContextMenu={(e) => {
              e.preventDefault();
              const W = 220;
              const H = 130;
              const margin = 8;
              const x = Math.min(e.clientX, window.innerWidth - W - margin);
              const y = Math.min(e.clientY, window.innerHeight - H - margin);
              setCanvasCtx({ x: Math.max(margin, x), y: Math.max(margin, y) });
            }}
          >
            <canvas
              ref={canvasRef}
              className="preview-canvas"
              width={state.canvas.width}
              height={state.canvas.height}
            />
            <CanvasOverlay
              canvasRef={canvasRef}
              canvasW={state.canvas.width}
              canvasH={state.canvas.height}
              activeClips={activeClips}
              selectedClipIds={state.selectedClipIds}
              isPlaying={state.isPlaying}
              dispatch={dispatch}
              mediaFiles={state.mediaFiles}
              pendingTransform={pendingTransform}
              setPendingTransform={setPendingTransform}
              editingTextId={editingTextId}
              setEditingTextId={setEditingTextId}
            />
          </div>
        ) : (
          <div className="preview-placeholder">
            <div className="preview-placeholder-icon">▶</div>
            <div className="preview-placeholder-text">
              Drop a video in the sidebar to begin
            </div>
          </div>
        )}
      </div>
      <div className="playback-controls">
        <span />
        <div className="playback-controls-group">
          <button
            className="control-btn"
            onClick={skipToStart}
            disabled={!hasClips}
            title="Skip to start"
            aria-label="Skip to start"
          >
            ⏮
          </button>
          <button
            className="play-btn"
            onClick={togglePlay}
            disabled={!hasClips}
            title={state.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
          >
            {state.isPlaying ? '⏸' : '▶'}
          </button>
          <button
            className="control-btn"
            onClick={skipToEnd}
            disabled={!hasClips}
            title="Skip to end"
            aria-label="Skip to end"
          >
            ⏭
          </button>
        </div>
        <span className="time-display">
          {formatTime(state.playheadPosition)} / {formatTime(totalDuration)}
        </span>
      </div>

      {canvasCtx && (
        <div
          className="context-menu"
          style={{ left: canvasCtx.x, top: canvasCtx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              if (state.selectedClipIds.length === 1) {
                dispatch({
                  type: 'SET_CLIP_TRANSFORM',
                  payload: {
                    clipId: state.selectedClipIds[0],
                    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
                  },
                });
              }
              setCanvasCtx(null);
            }}
            disabled={state.selectedClipIds.length !== 1}
          >
            <span>↺ Reset selected transform</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              for (const c of Object.values(state.clips)) {
                dispatch({
                  type: 'SET_CLIP_TRANSFORM',
                  payload: {
                    clipId: c.id,
                    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
                  },
                });
              }
              setCanvasCtx(null);
            }}
          >
            <span>↺ Reset ALL transforms</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying });
              setCanvasCtx(null);
            }}
          >
            <span>{state.isPlaying ? '⏸ Pause' : '⏵ Play'}</span>
            <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Space</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              dispatch({ type: 'SET_PLAYHEAD', payload: 0 });
              setCanvasCtx(null);
            }}
          >
            <span>⏮ Jump to start</span>
          </button>
        </div>
      )}
    </div>
  );
}
