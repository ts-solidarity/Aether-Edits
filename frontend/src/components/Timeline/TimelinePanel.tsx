import { useRef, useState, useCallback, useEffect } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { Clip, ImageClip, MediaFile, ProjectState, TransitionKind, VideoClip } from '../../types/project';
import { DEFAULT_TRANSFORM, clipDuration } from '../../types/project';
import { newId } from '../../utils/id';
import { getThumbnail } from '../../services/thumbnails';
import { FX_DRAG_MIME } from '../Sidebar/EffectsPanel';

/** Build a VideoClip or ImageClip from a MediaFile dropped on the timeline. */
function buildClipFromMedia(
  media: MediaFile,
  trackId: string,
  timelineStart: number
): VideoClip | ImageClip {
  if (media.kind === 'image') {
    return {
      id: newId('clip'),
      kind: 'image',
      mediaFileId: media.id,
      sourceStart: 0,
      sourceEnd: media.duration,
      timelineStart,
      trackId,
      fit: 'free',
      transform: { ...DEFAULT_TRANSFORM },
      color: null,
      speed: 1,
      transitionOut: null,
    };
  }
  return {
    id: newId('clip'),
    kind: 'video',
    mediaFileId: media.id,
    sourceStart: 0,
    sourceEnd: media.duration,
    timelineStart,
    trackId,
    volume: 1,
    muted: false,
    pan: 0,
    duckSourceClipId: null,
    duckAmount: 0.6,
    fit: 'contain',
    transform: { ...DEFAULT_TRANSFORM },
    color: null,
    speed: 1,
    transitionOut: null,
  };
}

const ADJACENCY_EPS = 0.01;

const TRACK_ROW_HEIGHT = 48;
const MIN_CLIP_DURATION = 0.05;
const SNAP_PX = 8;
const DRAG_THRESHOLD_PX = 3;

type DragMode = 'move' | 'trim-left' | 'trim-right';

interface DragState {
  mode: DragMode;
  clipId: string;
  startClientX: number;
  startClientY: number;
  origTimelineStart: number;
  origSourceStart: number;
  origSourceEnd: number;
  origTrackId: string;
  mediaDuration: number;
  preview: {
    timelineStart: number;
    sourceStart: number;
    sourceEnd: number;
    trackId: string;
  };
  hasMoved: boolean;
  snapTime: number | null; // time in seconds where snap indicator should render
}

function collectSnapPoints(state: ProjectState, excludeClipId: string): number[] {
  const pts = new Set<number>();
  pts.add(0);
  pts.add(state.playheadPosition);
  for (const clip of Object.values(state.clips)) {
    if (clip.id === excludeClipId) continue;
    pts.add(clip.timelineStart);
    pts.add(clip.timelineStart + clipDuration(clip));
  }
  return Array.from(pts);
}

function snap(candidate: number, points: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(candidate - p);
    if (d < threshold && d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/** Clips on `trackId` other than `excludeClipId`, sorted by timelineStart. */
function otherClipsOnTrack(
  state: ProjectState,
  trackId: string,
  excludeClipId: string
): Clip[] {
  const track = state.tracks[trackId];
  if (!track) return [];
  const out: Clip[] = [];
  for (const cid of track.clips) {
    const c = state.clips[cid];
    if (c && c.id !== excludeClipId) out.push(c);
  }
  out.sort((a, b) => a.timelineStart - b.timelineStart);
  return out;
}

/** Clamp a proposed left-edge position so [tl, tl+clipDur] doesn't overlap existing clips.
 *  Picks the closest free gap that can fit the clip. */
function clampToFreeSpace(
  proposedTl: number,
  clipDur: number,
  others: Clip[]
): number {
  // Build gaps
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const o of others) {
    const oStart = o.timelineStart;
    const oEnd = oStart + clipDuration(o);
    if (oStart > cursor) gaps.push([cursor, oStart]);
    cursor = Math.max(cursor, oEnd);
  }
  gaps.push([cursor, Infinity]);

  const fittable = gaps.filter(([s, e]) => e === Infinity || e - s + 1e-6 >= clipDur);
  if (fittable.length === 0) return Math.max(0, proposedTl);

  let bestTl = Math.max(0, proposedTl);
  let bestDist = Infinity;
  for (const [s, e] of fittable) {
    const maxStart = e === Infinity ? Infinity : e - clipDur;
    const clamped = Math.max(s, Math.min(maxStart, proposedTl));
    const dist = Math.abs(clamped - proposedTl);
    if (dist < bestDist) {
      bestDist = dist;
      bestTl = clamped;
    }
  }
  return bestTl;
}

/** Maximum right edge time before the next clip on the same track. */
function maxRightEdge(others: Clip[], originTl: number): number {
  let min = Infinity;
  for (const o of others) {
    if (o.timelineStart >= originTl) {
      min = Math.min(min, o.timelineStart);
    }
  }
  return min;
}

/** Minimum left edge time after the previous clip on the same track. */
function minLeftEdge(others: Clip[], originTl: number): number {
  let max = 0;
  for (const o of others) {
    const oEnd = o.timelineStart + clipDuration(o);
    if (oEnd <= originTl + 1e-6) {
      max = Math.max(max, oEnd);
    }
  }
  return max;
}

const THUMB_W = 80;
const THUMB_H = 45;

function ClipFilmStrip({ clip, media, widthPx }: { clip: VideoClip; media: MediaFile | undefined; widthPx: number }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!media?.file || widthPx < 40) {
      setUrls([]);
      return;
    }
    const n = Math.max(1, Math.floor(widthPx / THUMB_W));
    const duration = clip.sourceEnd - clip.sourceStart;
    const step = duration / Math.max(1, n);
    const targets = Array.from({ length: n }, (_, i) => clip.sourceStart + step * (i + 0.5));

    let cancelled = false;
    (async () => {
      const resolved: string[] = new Array(n);
      for (let i = 0; i < n; i++) {
        try {
          const u = await getThumbnail(clip.mediaFileId, media.file!, targets[i], THUMB_W, THUMB_H);
          if (cancelled) return;
          resolved[i] = u;
          // Progressive paint: update state as thumbs resolve to avoid blank strip during decode.
          setUrls([...resolved]);
        } catch {
          // ignore — a failed thumbnail just stays blank
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clip.mediaFileId, clip.sourceStart, clip.sourceEnd, media?.file, widthPx]);

  if (urls.length === 0) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: 0.55,
      }}
    >
      {urls.map((u, i) => (
        <div
          key={i}
          style={{
            flex: `0 0 ${THUMB_W}px`,
            height: '100%',
            backgroundImage: u ? `url(${u})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      ))}
    </div>
  );
}

function formatRulerTime(seconds: number): string {
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
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const stateRef = useRef(state);
  stateRef.current = state;

  const zoom = state.zoomLevel;
  const duration = getTimelineDuration(state.clips);
  const timelineWidth = duration * zoom;

  // Global mouse listeners while dragging.
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const curState = stateRef.current;
      const z = curState.zoomLevel;
      const threshold = SNAP_PX / z;
      const snapPoints = collectSnapPoints(curState, d.clipId);

      const dx = e.clientX - d.startClientX;
      const dy = e.clientY - d.startClientY;
      const dtime = dx / z;
      const hasMoved = d.hasMoved || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;

      let preview = { ...d.preview };
      let snapTime: number | null = null;

      if (d.mode === 'move') {
        const clipDur = d.origSourceEnd - d.origSourceStart;

        // Track detection: elementsFromPoint (plural) gives the full stack under
        // the cursor. The dragging clip itself is in that stack and its `closest`
        // walks up to the ORIGIN track row — so we must skip it. Prefer the
        // first track-row hit that isn't an ancestor of the dragging clip.
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        let hoveredTrackId: string | null = null;
        for (const el of stack) {
          const h = el as HTMLElement;
          if (h.hasAttribute('data-track-id')) {
            hoveredTrackId = h.getAttribute('data-track-id');
            break;
          }
        }

        // If the cursor is below all tracks (or near the bottom edge of the last
        // one) and we have an in-DOM tracks container to compare against, mark
        // this as a "new track" drop target.
        let targetTrackId: string;
        if (hoveredTrackId) {
          targetTrackId = hoveredTrackId;
        } else {
          const tracksContainer = document.querySelector('.tracks-container') as HTMLElement | null;
          const containerRect = tracksContainer?.getBoundingClientRect();
          if (
            containerRect &&
            e.clientY >= containerRect.bottom - 4 &&
            e.clientX >= containerRect.left &&
            e.clientX <= containerRect.right
          ) {
            targetTrackId = '__new__';
          } else {
            targetTrackId = d.preview.trackId || d.origTrackId;
          }
        }

        let newTl = Math.max(0, d.origTimelineStart + dtime);

        const leftSnap = snap(newTl, snapPoints, threshold);
        const rightSnap = snap(newTl + clipDur, snapPoints, threshold);
        if (leftSnap !== null && (rightSnap === null || Math.abs(newTl - leftSnap) <= Math.abs(newTl + clipDur - rightSnap))) {
          newTl = leftSnap;
          snapTime = leftSnap;
        } else if (rightSnap !== null) {
          newTl = rightSnap - clipDur;
          if (newTl < 0) newTl = 0;
          snapTime = rightSnap;
        }

        // Clamp into the nearest free gap on the target track so clips never overlap.
        // A "__new__" track is empty, so any timelineStart is free.
        if (targetTrackId !== '__new__') {
          const others = otherClipsOnTrack(curState, targetTrackId, d.clipId);
          newTl = clampToFreeSpace(newTl, clipDur, others);
        } else {
          newTl = Math.max(0, newTl);
        }

        preview.timelineStart = newTl;
        preview.trackId = targetTrackId;
      } else if (d.mode === 'trim-left') {
        const others = otherClipsOnTrack(curState, d.origTrackId, d.clipId);
        const minTl = minLeftEdge(others, d.origTimelineStart);

        let newSrcStart = d.origSourceStart + dtime;
        newSrcStart = Math.max(0, Math.min(d.origSourceEnd - MIN_CLIP_DURATION, newSrcStart));
        const srcDelta = newSrcStart - d.origSourceStart;
        let newTl = Math.max(0, d.origTimelineStart + srcDelta);

        // Snap newTl to snap points.
        const leftSnap = snap(newTl, snapPoints, threshold);
        if (leftSnap !== null) {
          const tlShift = leftSnap - newTl;
          newTl = leftSnap;
          newSrcStart += tlShift;
          snapTime = leftSnap;
        }

        // Don't let the left edge cross the previous clip on this track.
        if (newTl < minTl) {
          const shift = minTl - newTl;
          newTl = minTl;
          newSrcStart += shift;
        }
        newSrcStart = Math.max(0, Math.min(d.origSourceEnd - MIN_CLIP_DURATION, newSrcStart));
        preview.sourceStart = newSrcStart;
        preview.timelineStart = newTl;
      } else {
        // trim-right
        const others = otherClipsOnTrack(curState, d.origTrackId, d.clipId);
        const maxEndTl = maxRightEdge(others, d.origTimelineStart);

        let newSrcEnd = d.origSourceEnd + dtime;
        newSrcEnd = Math.max(d.origSourceStart + MIN_CLIP_DURATION, Math.min(d.mediaDuration, newSrcEnd));
        let rightEdge = d.origTimelineStart + (newSrcEnd - d.origSourceStart);

        const rightSnap = snap(rightEdge, snapPoints, threshold);
        if (rightSnap !== null) {
          const delta = rightSnap - rightEdge;
          newSrcEnd += delta;
          rightEdge = d.origTimelineStart + (newSrcEnd - d.origSourceStart);
          snapTime = rightEdge;
        }

        // Don't extend past the next clip on this track.
        if (rightEdge > maxEndTl) {
          newSrcEnd -= rightEdge - maxEndTl;
          rightEdge = maxEndTl;
        }
        newSrcEnd = Math.max(d.origSourceStart + MIN_CLIP_DURATION, Math.min(d.mediaDuration, newSrcEnd));
        preview.sourceEnd = newSrcEnd;
      }

      setDrag({ ...d, preview, hasMoved, snapTime });
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d) {
        setDrag(null);
        return;
      }
      if (d.hasMoved) {
        if (d.mode === 'move') {
          if (d.preview.trackId === '__new__') {
            // Materialise a fresh track and move the clip onto it.
            const newTrackId = newId('track');
            const trackName = `Track ${stateRef.current.trackOrder.length + 1}`;
            dispatch({ type: 'ADD_TRACK', payload: { name: trackName, id: newTrackId } });
            dispatch({
              type: 'MOVE_CLIP',
              payload: {
                clipId: d.clipId,
                newTimelineStart: d.preview.timelineStart,
                newTrackId,
              },
            });
          } else {
            dispatch({
              type: 'MOVE_CLIP',
              payload: {
                clipId: d.clipId,
                newTimelineStart: d.preview.timelineStart,
                newTrackId: d.preview.trackId !== d.origTrackId ? d.preview.trackId : undefined,
              },
            });
          }
        } else {
          dispatch({
            type: 'TRIM_CLIP',
            payload: {
              clipId: d.clipId,
              sourceStart: d.preview.sourceStart,
              sourceEnd: d.preview.sourceEnd,
              timelineStart: d.preview.timelineStart,
            },
          });
        }
      }
      setDrag(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // Only re-run when drag instance changes (clip or mode). preview/hasMoved updates
    // go through dragRef so we don't re-subscribe mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.clipId, drag?.mode]);

  const beginDrag = useCallback(
    (e: React.MouseEvent, clipId: string, mode: DragMode) => {
      if (e.button !== 0) return;
      const clip = stateRef.current.clips[clipId];
      if (!clip) return;
      // For trim-right, we clamp by source media duration on video clips.
      // Text clips have no underlying media — use a generous ceiling so the
      // user can extend the clip freely.
      const mediaDuration =
        clip.kind === 'video'
          ? stateRef.current.mediaFiles[clip.mediaFileId]?.duration ?? clip.sourceEnd
          : 3600;
      e.stopPropagation();
      e.preventDefault();
      setDrag({
        mode,
        clipId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origTimelineStart: clip.timelineStart,
        origSourceStart: clip.sourceStart,
        origSourceEnd: clip.sourceEnd,
        origTrackId: clip.trackId,
        mediaDuration,
        preview: {
          timelineStart: clip.timelineStart,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
          trackId: clip.trackId,
        },
        hasMoved: false,
        snapTime: null,
      });
    },
    []
  );

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Handle dropping media onto a track: place the clip at the cursor X, clamped
  // into the nearest free gap on the target track.
  const handleTrackDrop = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const mediaFileId = e.dataTransfer.getData('mediaFileId');
      if (!mediaFileId) return;

      const media = state.mediaFiles[mediaFileId];
      if (!media) return;

      const track = state.tracks[trackId];
      if (!track) return;

      // Compute drop position from cursor X within the timeline content.
      const contentEl = (e.currentTarget as HTMLElement).closest('.timeline-content') as HTMLElement | null;
      let proposedTl = 0;
      if (contentEl) {
        const rect = contentEl.getBoundingClientRect();
        proposedTl = Math.max(0, (e.clientX - rect.left) / zoom);
      }

      // Prevent overlap — snap into the closest free gap.
      const others = otherClipsOnTrack(state, trackId, '__new__');
      const clipDur = media.duration;
      const timelineStart = clampToFreeSpace(proposedTl, clipDur, others);

      const clip = buildClipFromMedia(media, trackId, timelineStart);
      dispatch({ type: 'ADD_CLIP', payload: { clip, trackId } });
    },
    [state, dispatch, zoom]
  );

  // Drop onto the "+ new track" zone — creates a fresh track and places the clip on it.
  const handleNewTrackDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mediaFileId = e.dataTransfer.getData('mediaFileId');
      if (!mediaFileId) return;

      const media = state.mediaFiles[mediaFileId];
      if (!media) return;

      const contentEl = (e.currentTarget as HTMLElement).closest('.timeline-content') as HTMLElement | null;
      let proposedTl = 0;
      if (contentEl) {
        const rect = contentEl.getBoundingClientRect();
        proposedTl = Math.max(0, (e.clientX - rect.left) / zoom);
      }

      const newTrackId = newId('track');
      const trackName = `Track ${state.trackOrder.length + 1}`;
      dispatch({ type: 'ADD_TRACK', payload: { name: trackName, id: newTrackId } });

      const clip = buildClipFromMedia(media, newTrackId, proposedTl);
      dispatch({ type: 'ADD_CLIP', payload: { clip, trackId: newTrackId } });
    },
    [state, dispatch, zoom]
  );

  const [newTrackHover, setNewTrackHover] = useState(false);
  const [hoverTrackId, setHoverTrackId] = useState<string | null>(null);

  // Effect-card drag is happening somewhere on the page. Used to reveal extra
  // drop slots between adjacent clips while the user holds an FX card.
  const [fxDragging, setFxDragging] = useState(false);
  // The clip currently being hovered by an FX drag (for visual highlight).
  const [fxDropTarget, setFxDropTarget] = useState<string | null>(null);

  useEffect(() => {
    const onStart = () => setFxDragging(true);
    const onEnd = () => {
      setFxDragging(false);
      setFxDropTarget(null);
    };
    window.addEventListener('aether-fx-drag-start', onStart);
    window.addEventListener('aether-fx-drag-end', onEnd);
    return () => {
      window.removeEventListener('aether-fx-drag-start', onStart);
      window.removeEventListener('aether-fx-drag-end', onEnd);
    };
  }, []);

  const applyTransitionToClip = useCallback(
    (clipId: string, kind: TransitionKind) => {
      const existing = stateRef.current.clips[clipId];
      if (!existing) return;
      const duration = existing.transitionOut?.duration ?? 1;
      dispatch({
        type: 'SET_CLIP_TRANSITION',
        payload: { clipId, transition: { kind, duration } },
      });
    },
    [dispatch]
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
    // Clamp to viewport so the menu never renders off-screen.
    const MENU_W = 200;
    const MENU_H = 96;
    const margin = 8;
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - margin);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - margin);
    setContextMenu({ x: Math.max(margin, x), y: Math.max(margin, y), clipId });
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

  const handleToggleCrossfade = () => {
    if (!contextMenu) return;
    const clip = state.clips[contextMenu.clipId];
    if (!clip) return;
    dispatch({
      type: 'SET_CLIP_TRANSITION',
      payload: {
        clipId: clip.id,
        transition: clip.transitionOut ? null : { kind: 'fade', duration: 1 },
      },
    });
    setContextMenu(null);
  };

  // Whether the context-menu's clip has an adjacent next clip on the same track
  // (gating "Add crossfade" to cases where the fade actually has a neighbor).
  const contextClip = contextMenu ? state.clips[contextMenu.clipId] : null;
  let hasAdjacentNext = false;
  if (contextClip) {
    const track = state.tracks[contextClip.trackId];
    if (track) {
      const sorted = track.clips
        .map((cid) => state.clips[cid])
        .filter((c): c is Clip => Boolean(c))
        .sort((a, b) => a.timelineStart - b.timelineStart);
      const idx = sorted.findIndex((c) => c.id === contextClip.id);
      if (idx >= 0 && idx < sorted.length - 1) {
        const next = sorted[idx + 1];
        const end = contextClip.timelineStart + clipDuration(contextClip);
        hasAdjacentNext = Math.abs(next.timelineStart - end) < ADJACENCY_EPS;
      }
    }
  }

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
          <div style={{ height: 26 }} />
          {state.trackOrder.map((trackId, trackIdx) => {
            const track = state.tracks[trackId];
            const trackHue = (270 + trackIdx * 73) % 360;
            return (
              <div
                key={trackId}
                className="track-label"
                style={{ ['--track-hue' as string]: trackHue }}
              >
                <div className="track-label-dot" />
                {track.name}
              </div>
            );
          })}
          <div className="track-label" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            + new
          </div>
        </div>

        <div
          className="timeline-scroll"
          ref={scrollRef}
          onClick={handleTimelineClick}
        >
          <div
            className="timeline-content"
            style={{ width: timelineWidth, position: 'relative' }}
          >
            <div className="timeline-ruler">{rulerMarks}</div>

            <div className="tracks-container">
              {state.trackOrder.map((trackId, trackIdx) => {
                const track = state.tracks[trackId];
                const trackHue = (270 + trackIdx * 73) % 360;
                // Adjacent pairs on this track for FX-drag gap slots.
                const sortedTrackClips = track.clips
                  .map((id) => state.clips[id])
                  .filter((c): c is Clip => Boolean(c))
                  .sort((a, b) => a.timelineStart - b.timelineStart);
                const gapSlots: { x: number; leftClipId: string }[] = [];
                for (let gi = 0; gi < sortedTrackClips.length - 1; gi++) {
                  const a = sortedTrackClips[gi];
                  const b = sortedTrackClips[gi + 1];
                  const aEnd = a.timelineStart + clipDuration(a);
                  if (Math.abs(aEnd - b.timelineStart) < ADJACENCY_EPS) {
                    gapSlots.push({ x: aEnd * zoom, leftClipId: a.id });
                  }
                }
                return (
                  <div
                    key={trackId}
                    className={`track-row ${hoverTrackId === trackId ? 'drag-over' : ''}`}
                    data-track-id={trackId}
                    style={{ ['--track-hue' as string]: trackHue }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoverTrackId(trackId);
                    }}
                    onDragLeave={() => setHoverTrackId(null)}
                    onDrop={(e) => {
                      setHoverTrackId(null);
                      handleTrackDrop(e, trackId);
                    }}
                  >
                    {fxDragging && gapSlots.map((slot, gi) => (
                      <div
                        key={`gap-${gi}`}
                        className="clip-gap-slot"
                        style={{ left: slot.x - 9, width: 18 }}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes(FX_DRAG_MIME)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'copy';
                          setFxDropTarget(slot.leftClipId);
                        }}
                        onDragLeave={() =>
                          setFxDropTarget((prev) => (prev === slot.leftClipId ? null : prev))
                        }
                        onDrop={(e) => {
                          const kind = e.dataTransfer.getData(FX_DRAG_MIME);
                          if (!kind) return;
                          e.preventDefault();
                          e.stopPropagation();
                          applyTransitionToClip(slot.leftClipId, kind as TransitionKind);
                          setFxDropTarget(null);
                        }}
                      />
                    ))}
                    {track.clips.map((clipId) => {
                      const clip = state.clips[clipId];
                      if (!clip) return null;
                      const isDragging = drag?.clipId === clipId;
                      if (isDragging && drag!.preview.trackId !== trackId) return null;

                      const effClip: Clip = isDragging
                        ? ({
                            ...clip,
                            timelineStart: drag!.preview.timelineStart,
                            sourceStart: drag!.preview.sourceStart,
                            sourceEnd: drag!.preview.sourceEnd,
                          } as Clip)
                        : clip;
                      const isVideo = effClip.kind === 'video';
                      const videoClip = isVideo ? (effClip as VideoClip) : null;
                      const isImage = effClip.kind === 'image';
                      const mediaId =
                        videoClip?.mediaFileId ??
                        (isImage ? (effClip as ImageClip).mediaFileId : undefined);
                      const media = mediaId ? state.mediaFiles[mediaId] : undefined;
                      const clipDurSec = clipDuration(effClip);
                      const left = effClip.timelineStart * zoom;
                      const width = clipDurSec * zoom;
                      const isSelected = state.selectedClipIds.includes(clipId);

                      const label =
                        effClip.kind === 'video' || effClip.kind === 'image'
                          ? media?.name ?? (effClip.kind === 'image' ? 'Image' : 'Clip')
                          : effClip.text || 'Text';
                      const tooltip = `${label}\n${formatRulerTime(clipDurSec)}`;

                      const showHandles = width > 24;
                      const hasFadeOut = !!effClip.transitionOut;

                      const isFxTarget = fxDropTarget === clipId;
                      return (
                        <div
                          key={clipId}
                          className={`clip clip-${effClip.kind} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isFxTarget ? 'fx-drop-target' : ''}`}
                          style={{ left, width: Math.max(width, 4) }}
                          title={tooltip}
                          onMouseDown={(e) => beginDrag(e, clipId, 'move')}
                          onClick={(e) => {
                            if (drag?.hasMoved) {
                              e.stopPropagation();
                              return;
                            }
                            handleClipClick(e, clipId);
                          }}
                          onContextMenu={(e) => handleClipContextMenu(e, clipId)}
                          onDragOver={(e) => {
                            if (!e.dataTransfer.types.includes(FX_DRAG_MIME)) return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                            setFxDropTarget(clipId);
                          }}
                          onDragLeave={(e) => {
                            if (!e.dataTransfer.types.includes(FX_DRAG_MIME)) return;
                            setFxDropTarget((prev) => (prev === clipId ? null : prev));
                          }}
                          onDrop={(e) => {
                            const kind = e.dataTransfer.getData(FX_DRAG_MIME);
                            if (!kind) return;
                            e.preventDefault();
                            e.stopPropagation();
                            applyTransitionToClip(clipId, kind as TransitionKind);
                            setFxDropTarget(null);
                          }}
                        >
                          {effClip.kind === 'video' && media ? (
                            <ClipFilmStrip clip={effClip as VideoClip} media={media} widthPx={width} />
                          ) : null}
                          <span>{width > 60 ? label : ''}</span>
                          {hasFadeOut && width > 12 && (
                            <div
                              className="clip-fade-indicator"
                              aria-hidden
                              style={{ width: Math.min(width * 0.4, 40) }}
                            />
                          )}
                          {showHandles && (
                            <>
                              <div
                                className="clip-trim-handle left"
                                onMouseDown={(e) => beginDrag(e, clipId, 'trim-left')}
                              />
                              <div
                                className="clip-trim-handle right"
                                onMouseDown={(e) => beginDrag(e, clipId, 'trim-right')}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div
                className={`new-track-drop-zone ${newTrackHover ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('mediaFileId') || e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    setNewTrackHover(true);
                  }
                }}
                onDragLeave={() => setNewTrackHover(false)}
                onDrop={(e) => {
                  setNewTrackHover(false);
                  handleNewTrackDrop(e);
                }}
              >
                + New track — drop a file here
              </div>
            </div>

            {/* Cross-track drag preview: render the dragging clip at its preview track if different. */}
            {drag && drag.preview.trackId !== drag.origTrackId && (() => {
              const clip = state.clips[drag.clipId];
              if (!clip) return null;
              const isNew = drag.preview.trackId === '__new__';
              const trackIdx = isNew ? state.trackOrder.length : state.trackOrder.indexOf(drag.preview.trackId);
              if (!isNew && trackIdx < 0) return null;
              const label =
                clip.kind === 'video'
                  ? state.mediaFiles[clip.mediaFileId]?.name ?? 'Clip'
                  : clip.kind === 'image'
                    ? state.mediaFiles[clip.mediaFileId]?.name ?? 'Image'
                    : clip.text || 'Text';
              const speed = (clip as { speed?: number }).speed ?? 1;
              const dur = (drag.preview.sourceEnd - drag.preview.sourceStart) / Math.max(0.01, speed);
              const left = drag.preview.timelineStart * zoom;
              const width = dur * zoom;
              const top = trackIdx * TRACK_ROW_HEIGHT + 4;
              return (
                <>
                  {isNew && (
                    <div
                      className="ghost-track-row"
                      style={{ top: trackIdx * TRACK_ROW_HEIGHT }}
                    />
                  )}
                  <div
                    className={`clip clip-${clip.kind} dragging`}
                    style={{
                      left,
                      width: Math.max(width, 4),
                      top,
                      position: 'absolute',
                      pointerEvents: 'none',
                    }}
                  >
                    <span>{width > 60 ? label : ''}</span>
                  </div>
                </>
              );
            })()}

            {/* Snap indicator */}
            {drag?.snapTime != null && (
              <div
                className="snap-indicator"
                style={{ left: drag.snapTime * zoom }}
              />
            )}

            {/* Playhead spans the ruler and all tracks */}
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
          {(hasAdjacentNext || contextClip?.transitionOut) && (
            <button className="context-menu-item" onClick={handleToggleCrossfade}>
              <span>
                {contextClip?.transitionOut ? '✕ Remove crossfade' : '◈ Add crossfade'}
              </span>
            </button>
          )}
          {contextClip && (
            <div className="context-menu-submenu">
              <div className="context-menu-submenu-label">⚡ Speed</div>
              <div className="context-menu-speed-grid">
                {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`context-menu-speed-chip ${Math.abs(contextClip.speed - s) < 0.01 ? 'active' : ''}`}
                    onClick={() => {
                      dispatch({ type: 'SET_CLIP_SPEED', payload: { clipId: contextClip.id, speed: s } });
                      setContextMenu(null);
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="context-menu-item danger" onClick={handleDelete}>
            <span>🗑️ Delete</span>
            <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>Del</span>
          </button>
        </div>
      )}
    </div>
  );
}
