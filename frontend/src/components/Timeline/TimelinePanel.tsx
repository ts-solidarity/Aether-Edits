import { useRef, useState, useCallback, useEffect } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { Clip } from '../../types/project';

function formatRulerTime(seconds: number): string {
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
  return Math.max(max + 5, 30); // At least 30s visible, with 5s padding
}

export function TimelinePanel() {
  const { state, dispatch } = useProject();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    clipId: string;
  } | null>(null);

  const zoom = state.zoomLevel;
  const duration = getTimelineDuration(state.clips);
  const timelineWidth = duration * zoom;

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Handle dropping media onto a track
  const handleTrackDrop = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault();
      const mediaFileId = e.dataTransfer.getData('mediaFileId');
      if (!mediaFileId) return;

      const media = state.mediaFiles[mediaFileId];
      if (!media) return;

      const track = state.tracks[trackId];
      let timelineStart = 0;
      if (track) {
        // Place after last clip
        for (const clipId of track.clips) {
          const c = state.clips[clipId];
          if (c) {
            const end = c.timelineStart + (c.sourceEnd - c.sourceStart);
            if (end > timelineStart) timelineStart = end;
          }
        }
      }

      const clipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const clip: Clip = {
        id: clipId,
        mediaFileId,
        sourceStart: 0,
        sourceEnd: media.duration,
        timelineStart,
        trackId,
      };
      dispatch({ type: 'ADD_CLIP', payload: { clip, trackId } });
    },
    [state.mediaFiles, state.tracks, state.clips, dispatch]
  );

  const handleClipClick = (e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    const isMulti = e.ctrlKey || e.metaKey;
    if (isMulti) {
      const ids = state.selectedClipIds.includes(clipId)
        ? state.selectedClipIds.filter((id) => id !== clipId)
        : [...state.selectedClipIds, clipId];
      dispatch({ type: 'SELECT_CLIP', payload: ids });
    } else {
      dispatch({ type: 'SELECT_CLIP', payload: [clipId] });
    }
  };

  const handleClipContextMenu = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: 'SELECT_CLIP', payload: [clipId] });
    setContextMenu({ x: e.clientX, y: e.clientY, clipId });
  };

  const handleSplit = () => {
    if (!contextMenu) return;
    dispatch({
      type: 'SPLIT_CLIP',
      payload: {
        clipId: contextMenu.clipId,
        splitTime: state.playheadPosition,
      },
    });
    setContextMenu(null);
  };

  const handleDelete = () => {
    if (!contextMenu) return;
    dispatch({ type: 'DELETE_CLIP', payload: { clipId: contextMenu.clipId } });
    setContextMenu(null);
  };

  // Click on empty timeline area to set playhead
  const handleTimelineClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, x / zoom);
    dispatch({ type: 'SET_PLAYHEAD', payload: time });
    dispatch({ type: 'SELECT_CLIP', payload: [] });
  };

  // Render ruler marks
  const rulerMarks = [];
  const step = zoom >= 80 ? 1 : zoom >= 30 ? 5 : 10;
  for (let t = 0; t <= duration; t += step) {
    rulerMarks.push(
      <div
        key={t}
        style={{
          position: 'absolute',
          left: t * zoom,
          top: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          paddingBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            paddingLeft: 4,
          }}
        >
          {formatRulerTime(t)}
        </span>
        <div
          style={{
            width: 1,
            height: 6,
            background: 'var(--border-color)',
          }}
        />
      </div>
    );
  }

  const playheadLeft = state.playheadPosition * zoom;

  return (
    <div className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Timeline</span>
        </div>
        <div className="timeline-toolbar-right">
          <div className="zoom-control">
            🔍
            <input
              type="range"
              min={10}
              max={200}
              value={zoom}
              onChange={(e) =>
                dispatch({
                  type: 'SET_ZOOM',
                  payload: Number(e.target.value),
                })
              }
            />
          </div>
          <button
            className="btn btn-ghost"
            onClick={() =>
              dispatch({
                type: 'ADD_TRACK',
                payload: { name: `Video ${state.trackOrder.length + 1}` },
              })
            }
          >
            + Add Track
          </button>
        </div>
      </div>

      <div className="timeline-body">
        <div className="track-labels">
          <div style={{ height: 24 }} />
          {state.trackOrder.map((trackId) => {
            const track = state.tracks[trackId];
            return (
              <div key={trackId} className="track-label">
                <div className="track-label-dot" />
                {track.name}
              </div>
            );
          })}
        </div>

        <div
          className="timeline-scroll"
          ref={scrollRef}
          onClick={handleTimelineClick}
        >
          <div
            className="timeline-ruler"
            style={{ width: timelineWidth, position: 'relative' }}
          >
            {rulerMarks}
          </div>

          <div
            className="tracks-container"
            style={{ width: timelineWidth, position: 'relative' }}
          >
            {state.trackOrder.map((trackId) => {
              const track = state.tracks[trackId];
              return (
                <div
                  key={trackId}
                  className="track-row"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleTrackDrop(e, trackId)}
                >
                  {track.clips.map((clipId) => {
                    const clip = state.clips[clipId];
                    if (!clip) return null;
                    const media = state.mediaFiles[clip.mediaFileId];
                    const clipDuration = clip.sourceEnd - clip.sourceStart;
                    const left = clip.timelineStart * zoom;
                    const width = clipDuration * zoom;
                    const isSelected =
                      state.selectedClipIds.includes(clipId);

                    const clipStartFmt = formatRulerTime(clip.sourceStart);
                    const clipEndFmt = formatRulerTime(clip.sourceEnd);
                    const tooltip = `${media?.name ?? 'Clip'}\n${clipStartFmt} - ${clipEndFmt} (${formatRulerTime(clipDuration)})`;

                    return (
                      <div
                        key={clipId}
                        className={`clip ${isSelected ? 'selected' : ''}`}
                        style={{ left, width: Math.max(width, 4) }}
                        title={tooltip}
                        onClick={(e) => handleClipClick(e, clipId)}
                        onContextMenu={(e) =>
                          handleClipContextMenu(e, clipId)
                        }
                      >
                        {width > 60 ? (media?.name ?? 'Clip') : ''}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Playhead */}
            <div className="playhead" style={{ left: playheadLeft }} />
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleSplit}>
            <span>✂️ Split at Playhead</span>
            <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>S</span>
          </button>
          <button
            className="context-menu-item danger"
            onClick={handleDelete}
          >
            <span>🗑️ Delete</span>
            <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Del</span>
          </button>
        </div>
      )}
    </div>
  );
}
