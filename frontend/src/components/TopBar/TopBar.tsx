import { useRef, useState } from 'react';
import { useProject } from '../../state/ProjectContext';

export function TopBar({ onExport }: { onExport: () => void }) {
  const { dispatch, canUndo, canRedo, flushSave } = useProject();
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
