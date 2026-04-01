import { useRef, useState, useCallback } from 'react';
import { useProject } from '../../state/ProjectContext';
import type { MediaFile } from '../../types/project';

export function Sidebar() {
  const { state, dispatch } = useProject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  const handleFiles = useCallback(
    (files: FileList) => {
      Array.from(files).forEach((file) => {
        if (!file.type.startsWith('video/')) return;
        const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const objectUrl = URL.createObjectURL(file);

        setLoadingFiles((prev) => new Set(prev).add(id));

        // Use a separate URL for the temp metadata probe
        const probeUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          const mediaFile: MediaFile = {
            id,
            name: file.name,
            objectUrl,
            file,
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            uploaded: false,
            backendId: null,
          };
          dispatch({ type: 'ADD_MEDIA_FILE', payload: mediaFile });
          setLoadingFiles((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          URL.revokeObjectURL(probeUrl);
        };
        video.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          URL.revokeObjectURL(probeUrl);
          setLoadingFiles((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
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

  const mediaFiles = Object.values(state.mediaFiles);
  const hasSelection = state.selectedClipIds.length > 0;

  return (
    <aside className="sidebar">
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
          <div className="drop-zone-icon">📁</div>
          <div className="drop-zone-text">Drop files here</div>
          <div className="drop-zone-hint">or click to browse</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
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
                  <div className="file-item-name">Loading{loadingFiles.size > 1 ? ` (${loadingFiles.size})` : ''}...</div>
                  <div className="file-item-meta">Reading metadata</div>
                </div>
              </div>
            )}
            {mediaFiles.map((f) => (
              <div
                key={f.id}
                className="file-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('mediaFileId', f.id);
                }}
              >
                <div className="file-item-icon">🎬</div>
                <div className="file-item-info">
                  <div className="file-item-name">{f.name}</div>
                  <div className="file-item-meta">
                    {`${Math.floor(f.duration / 60)}:${Math.floor(f.duration % 60).toString().padStart(2, '0')}`}
                    {f.width > 0 && ` · ${f.width}x${f.height}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="sidebar-section-title">Quick Tools</div>
        <div className="quick-tools">
          <button
            className="tool-btn"
            disabled={state.selectedClipIds.length !== 1}
            onClick={handleSplitAtPlayhead}
          >
            ✂️ Split at Playhead
          </button>
          <button
            className="tool-btn"
            disabled={!hasSelection}
            onClick={handleDeleteSelected}
          >
            🗑️ Delete Selected
          </button>
        </div>
      </div>
    </aside>
  );
}
