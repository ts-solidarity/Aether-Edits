import { useProject } from '../../state/ProjectContext';

export function TopBar({ onExport }: { onExport: () => void }) {
  const { dispatch, canUndo, canRedo } = useProject();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">
          <svg viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="url(#logo-grad)" />
            <path
              d="M8 10l4 4-4 4M14 18h6"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="28" y2="28">
                <stop stopColor="#7c5cfc" />
                <stop offset="1" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
          Montaj
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
        <button className="btn btn-secondary">Save</button>
        <button className="btn btn-primary" onClick={onExport}>Export</button>
      </div>
    </header>
  );
}
