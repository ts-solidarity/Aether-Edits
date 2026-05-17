import { useRef, useState } from 'react';
import { useProject } from '../../state/ProjectContext';
import { CANVAS_PRESETS } from '../../types/project';

export function TopBar({ onExport }: { onExport: () => void }) {
  const { state, dispatch, canUndo, canRedo, flushSave } = useProject();
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<number | null>(null);

  const handleSave = () => {
    flushSave();
    setJustSaved(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setJustSaved(false);
      savedTimerRef.current = null;
    }, 1500);
  };

  // Match the project's current canvas to a preset key (for the dropdown's
  // active value). Falls back to the first preset's key if no match.
  const activeKey =
    CANVAS_PRESETS.find(
      (p) => p.size.width === state.canvas.width && p.size.height === state.canvas.height
    )?.key ?? '';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">
          <div className="topbar-logo-mark" aria-hidden>
            <span>Æ</span>
          </div>
          Aether Edits
          <span className="topbar-badge">Beta</span>
        </div>
      </div>

      <div className="topbar-center">
        <label className="topbar-canvas-picker" title="Project canvas — preview & export use this">
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Canvas
          </span>
          <select
            value={activeKey}
            onChange={(e) => {
              const preset = CANVAS_PRESETS.find((p) => p.key === e.target.value);
              if (preset) {
                dispatch({ type: 'SET_CANVAS', payload: { ...preset.size } });
              }
            }}
          >
            {CANVAS_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} · {p.size.width}×{p.size.height}
              </option>
            ))}
            {activeKey === '' && (
              <option value="" disabled>
                Custom · {state.canvas.width}×{state.canvas.height}
              </option>
            )}
          </select>
        </label>
        <button
          className="btn btn-ghost"
          disabled={!canUndo}
          onClick={() => dispatch({ type: 'UNDO' })}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="btn btn-ghost"
          disabled={!canRedo}
          onClick={() => dispatch({ type: 'REDO' })}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↪ Redo
        </button>
      </div>

      <div className="topbar-right">
        <button className="btn btn-secondary" onClick={handleSave}>
          {justSaved ? 'Saved ✓' : 'Save'}
        </button>
        <button className="btn btn-primary" onClick={onExport}>Export</button>
      </div>
    </header>
  );
}
