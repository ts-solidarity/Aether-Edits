import { useProject } from '../../state/ProjectContext';
import { useExport } from '../../hooks/useExport';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { state, dispatch } = useProject();
  const { exportState, startExportFlow, reset } = useExport(state, dispatch);

  if (!open) return null;

  const handleClose = () => {
    reset();
    onClose();
  };

  const isWorking = exportState.phase === 'uploading' || exportState.phase === 'exporting';
  const hasClips = Object.keys(state.clips).length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={isWorking ? undefined : handleClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: 32,
          width: 420,
          maxWidth: '90vw',
          boxShadow: 'var(--shadow-md)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, marginBottom: 20 }}>Export Video</h2>

        {exportState.phase === 'idle' && (
          <>
            {hasClips ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Your timeline will be rendered as an MP4 video using server-side FFmpeg.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 20 }}>
                Add clips to the timeline before exporting.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={startExportFlow} disabled={!hasClips}>
                Export
              </button>
            </div>
          </>
        )}

        {exportState.phase === 'uploading' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Uploading media files...
            </p>
            <ProgressBar progress={exportState.progress} />
          </>
        )}

        {exportState.phase === 'exporting' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Rendering video...
            </p>
            <ProgressBar progress={exportState.progress} />
          </>
        )}

        {exportState.phase === 'done' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--success)', marginBottom: 16 }}>
              Export complete!
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleClose}>
                Close
              </button>
              {exportState.downloadUrl && (
                <a
                  href={exportState.downloadUrl}
                  download
                  className="btn btn-primary"
                  style={{ textDecoration: 'none' }}
                >
                  Download
                </a>
              )}
            </div>
          </>
        )}

        {exportState.phase === 'error' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>
              {exportState.error}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleClose}>
                Close
              </button>
              <button className="btn btn-primary" onClick={startExportFlow}>
                Retry
              </button>
            </div>
          </>
        )}

        {isWorking && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
            Please don't close this window.
          </p>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div
      style={{
        width: '100%',
        height: 8,
        background: 'var(--bg-tertiary)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${Math.min(progress, 100)}%`,
          height: '100%',
          background: 'var(--accent-gradient)',
          borderRadius: 4,
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  );
}
