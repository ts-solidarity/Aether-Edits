import { useEffect, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { useExport } from '../../hooks/useExport';
import type { QualityPreset } from '../../services/filterGraph';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

const QUALITY_OPTIONS: { value: QualityPreset; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: 'ultrafast · CRF 26 · best for previews' },
  { value: 'balanced', label: 'Balanced', hint: 'fast preset · CRF 24' },
  { value: 'quality', label: 'Quality', hint: 'medium preset · CRF 22 · much slower on wasm' },
];

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { state } = useProject();
  const { exportState, startExportFlow, reset, readiness } = useExport();
  const [quality, setQuality] = useState<QualityPreset>('fast');

  // Revoke the download blob URL when the dialog closes or phase leaves 'done'.
  useEffect(() => {
    if (!open) {
      reset();
    }
  }, [open, reset]);

  if (!open) return null;

  const handleClose = () => {
    reset();
    onClose();
  };

  const isWorking =
    exportState.phase === 'waiting' ||
    exportState.phase === 'loading-core' ||
    exportState.phase === 'exporting';
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
          width: 460,
          maxWidth: '90vw',
          boxShadow: 'var(--shadow-md)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, marginBottom: 20 }}>Export Video</h2>

        {exportState.phase === 'idle' && (
          <>
            {!hasClips ? (
              <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 20 }}>
                Add clips to the timeline before exporting.
              </p>
            ) : readiness.missing > 0 ? (
              <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 20 }}>
                {readiness.missing} media file{readiness.missing > 1 ? 's are' : ' is'} missing — re-import before exporting.
              </p>
            ) : readiness.hydrating > 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                Loading media from storage…
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                  Export runs in your browser with FFmpeg.wasm — nothing is uploaded.
                </p>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                    Canvas
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {state.canvas.width} × {state.canvas.height}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    What you see in the preview is what will be exported. Change the size from the canvas picker in the top bar.
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                    Quality / Speed
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {QUALITY_OPTIONS.map((opt) => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="quality"
                          value={opt.value}
                          checked={quality === opt.value}
                          onChange={() => setQuality(opt.value)}
                        />
                        <span>{opt.label}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {opt.hint}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => startExportFlow(quality)}
                disabled={!hasClips || !readiness.allReady}
              >
                Export
              </button>
            </div>
          </>
        )}

        {exportState.phase === 'waiting' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Loading media from storage…
            </p>
            <ProgressBar progress={exportState.progress} />
          </>
        )}

        {exportState.phase === 'loading-core' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Loading FFmpeg engine (one-time, ~10 MB)…
            </p>
            <ProgressBar progress={0} indeterminate />
          </>
        )}

        {exportState.phase === 'exporting' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Rendering video…
            </p>
            <ProgressBar progress={exportState.progress} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              In-browser encoding is CPU-bound and can take several minutes for longer clips.
            </p>
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
                  download="aether-edits-export.mp4"
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
              <button className="btn btn-primary" onClick={() => startExportFlow(quality)}>
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

function ProgressBar({ progress, indeterminate }: { progress: number; indeterminate?: boolean }) {
  return (
    <div
      style={{
        width: '100%',
        height: 8,
        background: 'var(--bg-tertiary)',
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: indeterminate ? '40%' : `${Math.min(progress, 100)}%`,
          height: '100%',
          background: 'var(--accent-gradient)',
          borderRadius: 4,
          transition: 'width 0.3s ease',
          animation: indeterminate ? 'montaj-indet 1.2s ease-in-out infinite' : 'none',
        }}
      />
    </div>
  );
}
