import { useRef, useEffect, useCallback } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { Clip } from '../../types/project';

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

export function PreviewPanel() {
  const { state, dispatch } = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const hasClips = Object.keys(state.clips).length > 0;
  const totalDuration = getTimelineDuration(state.clips);

  // Create hidden video elements for each media file
  useEffect(() => {
    const current = videoRefs.current;
    for (const [id, media] of Object.entries(state.mediaFiles)) {
      if (!current.has(id)) {
        const vid = document.createElement('video');
        vid.src = media.objectUrl;
        vid.preload = 'auto';
        vid.muted = true;
        current.set(id, vid);
      }
    }
  }, [state.mediaFiles]);

  const findClipAtTime = useCallback(
    (time: number): Clip | null => {
      for (const trackId of state.trackOrder) {
        const track = state.tracks[trackId];
        for (const clipId of track.clips) {
          const clip = state.clips[clipId];
          if (!clip) continue;
          const clipEnd = clip.timelineStart + (clip.sourceEnd - clip.sourceStart);
          if (time >= clip.timelineStart && time < clipEnd) {
            return clip;
          }
        }
      }
      return null;
    },
    [state.tracks, state.clips, state.trackOrder]
  );

  const drawFrame = useCallback(
    (video: HTMLVideoElement) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    },
    []
  );

  const drawBlack = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // Render a still frame when paused and playhead or clips change
  useEffect(() => {
    if (!hasClips || state.isPlaying) return;

    const clip = findClipAtTime(state.playheadPosition);
    if (!clip) {
      drawBlack();
      return;
    }

    const video = videoRefs.current.get(clip.mediaFileId);
    if (!video) return;

    const sourceTime = clip.sourceStart + (state.playheadPosition - clip.timelineStart);

    const onSeeked = () => {
      drawFrame(video);
      video.removeEventListener('seeked', onSeeked);
    };

    if (Math.abs(video.currentTime - sourceTime) > 0.05) {
      video.addEventListener('seeked', onSeeked);
      video.currentTime = sourceTime;
    } else {
      drawFrame(video);
    }
  }, [hasClips, state.isPlaying, state.playheadPosition, state.clips, findClipAtTime, drawFrame, drawBlack]);

  // Playback animation loop (only runs while playing)
  useEffect(() => {
    if (!hasClips || !state.isPlaying) return;

    lastTimeRef.current = 0;

    const render = (timestamp: number) => {
      const delta = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = timestamp;

      const currentPos = state.playheadPosition + delta;
      if (currentPos >= totalDuration) {
        dispatch({ type: 'SET_PLAYING', payload: false });
        dispatch({ type: 'SET_PLAYHEAD', payload: totalDuration });
        return;
      }
      dispatch({ type: 'SET_PLAYHEAD', payload: currentPos });

      const clip = findClipAtTime(currentPos);
      if (clip) {
        const video = videoRefs.current.get(clip.mediaFileId);
        if (video) {
          const sourceTime = clip.sourceStart + (currentPos - clip.timelineStart);
          if (Math.abs(video.currentTime - sourceTime) > 0.1) {
            video.currentTime = sourceTime;
          }
          drawFrame(video);
        }
      } else {
        drawBlack();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [hasClips, state.isPlaying, state.playheadPosition, findClipAtTime, totalDuration, dispatch, drawFrame, drawBlack]);

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
            width={854}
            height={480}
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
