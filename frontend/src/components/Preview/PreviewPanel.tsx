import { useRef, useEffect, useCallback, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { Clip, ProjectState } from '../../types/project';

const CANVAS_W = 854;
const CANVAS_H = 480;
const ACTIVE_WINDOW_SECONDS = 3;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTimelineDuration(clips: Record<string, Clip>): number {
  let max = 0;
  for (const clip of Object.values(clips)) {
    const end = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
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
      const end = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
      if (time >= clip.timelineStart && time < end) out.push(clip);
    }
  }
  return out;
}

/** Letterbox draw matching FFmpeg: scale force_original_aspect_ratio=decrease + pad center + black. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(w / vw, h / vh);
  const dw = Math.round(vw * scale);
  const dh = Math.round(vh * scale);
  const dx = Math.floor((w - dw) / 2);
  const dy = Math.floor((h - dh) / 2);
  ctx.drawImage(video, dx, dy, dw, dh);
}

export function PreviewPanel() {
  const { state, dispatch } = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Per-clip video elements. Two clips sharing a media file need independent currentTime.
  // A proper LRU pool of 8–12 elements is the right answer for 50+ clip projects — deferred.
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  // Tracks clipIds whose video has had at least one successful `seeked` event.
  // Detached videos return empty frames from drawImage until a seek actually decodes.
  const primedClipsRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  // Triggers re-render when a <video> fires loadeddata so the still-frame effect redraws.
  const [videoLoadTick, setVideoLoadTick] = useState(0);

  const hasClips = Object.keys(state.clips).length > 0;
  const totalDuration = getTimelineDuration(state.clips);

  // Ensure a <video> element per clip; prune ones whose clip was deleted.
  useEffect(() => {
    const current = videoRefs.current;
    const alive = new Set(Object.keys(state.clips));
    for (const clipId of Array.from(current.keys())) {
      if (!alive.has(clipId)) {
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
    for (const clipId of alive) {
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

  // Lazy src-attach: only clips within playhead ±3s get a src (keeps active decoders small).
  useEffect(() => {
    for (const [clipId, v] of videoRefs.current) {
      const clip = state.clips[clipId];
      if (!clip) continue;
      const media = state.mediaFiles[clip.mediaFileId];
      if (!media?.objectUrl) {
        if (v.src) {
          v.removeAttribute('src');
          v.load();
        }
        continue;
      }
      const clipStart = clip.timelineStart;
      const clipEnd = clipStart + (clip.sourceEnd - clip.sourceStart);
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

  // Still-frame (paused): seek each active clip to its source time, then composite bottom→top.
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
      // Kick each clip toward its source time; wait for readiness where needed.
      for (const clip of active) {
        const v = videoRefs.current.get(clip.id);
        if (!v || !v.src) continue;
        const src = clip.sourceStart + (state.playheadPosition - clip.timelineStart);
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
            // If we're already at `src` and haven't primed yet, force a tiny nudge
            // to coerce the decoder into producing its first frame.
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
      for (const clip of active) {
        const v = videoRefs.current.get(clip.id);
        if (!v || v.readyState < 2) continue;
        drawFitted(ctx, v, canvas.width, canvas.height);
      }
    };

    render();

    return () => {
      cancelled = true;
      for (const { v, handler, type } of pending) {
        v.removeEventListener(type, handler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClips, state.isPlaying, state.playheadPosition, state.clips, state.mediaFiles, videoLoadTick]);

  // Playback loop: per-frame composite of all active clips.
  useEffect(() => {
    if (!hasClips || !state.isPlaying) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    lastTimeRef.current = 0;

    const render = (timestamp: number) => {
      const delta = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = timestamp;
      const t = state.playheadPosition + delta;
      if (t >= totalDuration) {
        dispatch({ type: 'SET_PLAYING', payload: false });
        dispatch({ type: 'SET_PLAYHEAD', payload: totalDuration });
        return;
      }
      dispatch({ type: 'SET_PLAYHEAD', payload: t });

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const clip of findActiveClipsAtTime(state, t)) {
        const v = videoRefs.current.get(clip.id);
        if (!v || v.readyState < 2) continue;
        const src = clip.sourceStart + (t - clip.timelineStart);
        if (Math.abs(v.currentTime - src) > 0.1) v.currentTime = src;
        drawFitted(ctx, v, canvas.width, canvas.height);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
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

  return (
    <div className="preview-panel">
      <div className="preview-canvas-container">
        {hasClips ? (
          <canvas
            ref={canvasRef}
            className="preview-canvas"
            width={CANVAS_W}
            height={CANVAS_H}
          />
        ) : (
          <div className="preview-placeholder">
            <div className="preview-placeholder-icon">▶</div>
            <div className="preview-placeholder-text">
              Drop a video to begin editing
            </div>
          </div>
        )}
      </div>
      <div className="playback-controls">
        <button className="play-btn" onClick={togglePlay} disabled={!hasClips}>
          {state.isPlaying ? '⏸' : '▶'}
        </button>
        <span className="time-display">
          {formatTime(state.playheadPosition)} / {formatTime(totalDuration)}
        </span>
      </div>
    </div>
  );
}
