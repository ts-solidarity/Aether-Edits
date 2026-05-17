import { useRef, useState, useCallback } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { MediaFile, TextClip } from '../../types/project';
import { DEFAULT_TRANSFORM } from '../../types/project';
import { newId } from '../../utils/id';
import { getOrCreateObjectUrl, saveFile } from '../../services/mediaStore';
import { Inspector } from '../Inspector/Inspector';
import { EffectsPanel } from './EffectsPanel';

const DEFAULT_TEXT_DURATION = 3;

type SidebarTab = 'media' | 'fx' | 'inspect';

export function Sidebar() {
  const { state, dispatch } = useProject();
  const [tab, setTab] = useState<SidebarTab>('media');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  const handleFiles = useCallback(
    (files: FileList) => {
      Array.from(files).forEach((file) => {
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        if (!isVideo && !isImage) return;
        const id = newId('media');

        setLoadingFiles((prev) => new Set(prev).add(id));

        const finishLoading = () => {
          setLoadingFiles((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        };

        const finalizeMeta = async (
          duration: number,
          width: number,
          height: number,
          kind: 'video' | 'image'
        ) => {
          const objectUrl = getOrCreateObjectUrl(id, file);
          const mediaFile: MediaFile = {
            id,
            name: file.name,
            objectUrl,
            file,
            duration,
            width,
            height,
            status: 'ready',
            hasAudio: kind === 'video',
            kind,
          };
          dispatch({ type: 'ADD_MEDIA_FILE', payload: mediaFile });
          try {
            await saveFile(id, file);
          } catch (err) {
            console.warn('IDB saveFile failed:', err);
            dispatch({ type: 'SET_MEDIA_STATUS', payload: { id, status: 'missing' } });
          }
          finishLoading();
        };

        if (isImage) {
          const probeUrl = URL.createObjectURL(file);
          const img = new Image();
          img.onload = () => {
            void finalizeMeta(4, img.naturalWidth, img.naturalHeight, 'image');
            URL.revokeObjectURL(probeUrl);
          };
          img.onerror = () => {
            URL.revokeObjectURL(probeUrl);
            finishLoading();
          };
          img.src = probeUrl;
          return;
        }

        const probeUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';

        const finalizeVideo = (duration: number) => {
          void finalizeMeta(duration, video.videoWidth, video.videoHeight, 'video');
          URL.revokeObjectURL(probeUrl);
        };

        video.onloadedmetadata = () => {
          const reported = video.duration;
          const looksBad = !Number.isFinite(reported) || reported <= 0;
          if (!looksBad) {
            finalizeVideo(reported);
            return;
          }

          const onTimeUpdate = () => {
            video.removeEventListener('timeupdate', onTimeUpdate);
            const real = video.duration;
            video.currentTime = 0;
            finalizeVideo(Number.isFinite(real) && real > 0 ? real : 0);
          };
          video.addEventListener('timeupdate', onTimeUpdate);
          try {
            video.currentTime = Number.MAX_SAFE_INTEGER;
          } catch {
            video.removeEventListener('timeupdate', onTimeUpdate);
            finalizeVideo(Number.isFinite(reported) && reported > 0 ? reported : 0);
          }
        };
        video.onerror = () => {
          URL.revokeObjectURL(probeUrl);
          finishLoading();
        };
        video.src = probeUrl;
      });
    },
    [dispatch]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleSplitAtPlayhead = () => {
    if (state.selectedClipIds.length !== 1) return;
    dispatch({
      type: 'SPLIT_CLIP',
      payload: {
        clipId: state.selectedClipIds[0],
        splitTime: state.playheadPosition,
      },
    });
  };

  const handleDeleteSelected = () => {
    state.selectedClipIds.forEach((clipId) => {
      dispatch({ type: 'DELETE_CLIP', payload: { clipId } });
    });
  };

  const handleAddText = () => {
    const trackId = state.trackOrder[0];
    if (!trackId) return;
    const clip: TextClip = {
      id: newId('clip'),
      kind: 'text',
      sourceStart: 0,
      sourceEnd: DEFAULT_TEXT_DURATION,
      timelineStart: state.playheadPosition,
      trackId,
      text: 'Your text',
      color: '#ffffff',
      fontSize: 8,
      fontFamily: 'sans',
      transform: { ...DEFAULT_TRANSFORM },
      speed: 1,
      transitionOut: null,
    };
    dispatch({ type: 'ADD_CLIP', payload: { clip, trackId } });
    dispatch({ type: 'SELECT_CLIP', payload: [clip.id] });
  };

  const mediaFiles = Object.values(state.mediaFiles);
  const hasSelection = state.selectedClipIds.length > 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${tab === 'media' ? 'active' : ''}`}
          onClick={() => setTab('media')}
        >
          <span className="sidebar-tab-icon">🎬</span>
          Media
        </button>
        <button
          className={`sidebar-tab ${tab === 'fx' ? 'active' : ''}`}
          onClick={() => setTab('fx')}
        >
          <span className="sidebar-tab-icon">✦</span>
          Effects
        </button>
        <button
          className={`sidebar-tab ${tab === 'inspect' ? 'active' : ''}`}
          onClick={() => setTab('inspect')}
        >
          <span className="sidebar-tab-icon">⚙</span>
          Inspect
        </button>
      </div>

      <div className="sidebar-content">
        {tab === 'media' && (
          <>
            <div>
              <div className="sidebar-section-title">Import</div>
              <div
                className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="drop-zone-icon">⬆</div>
                <div className="drop-zone-text">Drop video or image files</div>
                <div className="drop-zone-hint">or click to browse</div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>

            {(mediaFiles.length > 0 || loadingFiles.size > 0) && (
              <div>
                <div className="sidebar-section-title">Files</div>
                <div className="file-list">
                  {loadingFiles.size > 0 && (
                    <div className="file-item" style={{ opacity: 0.5 }}>
                      <div className="file-item-icon" style={{ animation: 'spin 1s linear infinite' }}>⏳</div>
                      <div className="file-item-info">
                        <div className="file-item-name">Loading{loadingFiles.size > 1 ? ` (${loadingFiles.size})` : ''}…</div>
                        <div className="file-item-meta">Reading metadata</div>
                      </div>
                    </div>
                  )}
                  {mediaFiles.map((f) => {
                    const statusLabel =
                      f.status === 'hydrating'
                        ? 'Loading…'
                        : f.status === 'missing'
                          ? 'Missing — re-import'
                          : null;
                    const statusColor =
                      f.status === 'missing' ? 'var(--danger)' : 'var(--text-muted)';
                    return (
                      <div
                        key={f.id}
                        className="file-item"
                        draggable={f.status === 'ready'}
                        style={{ opacity: f.status === 'ready' ? 1 : 0.6 }}
                        onDragStart={(e) => {
                          if (f.status !== 'ready') {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.setData('mediaFileId', f.id);
                        }}
                      >
                        <div className="file-item-icon">▶</div>
                        <div className="file-item-info">
                          <div className="file-item-name">{f.name}</div>
                          <div className="file-item-meta">
                            {`${Math.floor(f.duration / 60)}:${Math.floor(f.duration % 60).toString().padStart(2, '0')}`}
                            {f.width > 0 && ` · ${f.width}×${f.height}`}
                            {statusLabel && (
                              <>
                                {' · '}
                                <span style={{ color: statusColor }}>{statusLabel}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="sidebar-section-title">Quick Tools</div>
              <div className="quick-tools">
                <button className="tool-btn" onClick={handleAddText}>
                  <span>𝐓</span> Add Text
                </button>
                <button
                  className="tool-btn"
                  disabled={state.selectedClipIds.length !== 1}
                  onClick={handleSplitAtPlayhead}
                >
                  <span>✂</span> Split at Playhead
                </button>
                <button
                  className="tool-btn"
                  disabled={!hasSelection}
                  onClick={handleDeleteSelected}
                >
                  <span>🗑</span> Delete Selected
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'fx' && <EffectsPanel />}

        {tab === 'inspect' && <Inspector />}
      </div>
    </aside>
  );
}
