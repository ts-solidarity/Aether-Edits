import { useEffect, useState } from 'react';
import { ProjectProvider, useProject } from './state/ProjectContext';
import { TopBar } from './components/TopBar/TopBar';
import { Sidebar } from './components/Sidebar/Sidebar';
import { PreviewPanel } from './components/Preview/PreviewPanel';
import { TimelinePanel } from './components/Timeline/TimelinePanel';
import { ExportDialog } from './components/Export/ExportDialog';

function EditorShortcuts() {
  const { state, dispatch } = useProject();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      } else if (e.key === ' ') {
        e.preventDefault();
        dispatch({ type: 'SET_PLAYING', payload: !state.isPlaying });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        state.selectedClipIds.forEach((clipId) => {
          dispatch({ type: 'DELETE_CLIP', payload: { clipId } });
        });
      } else if (e.key === 's' && !(e.ctrlKey || e.metaKey)) {
        if (state.selectedClipIds.length === 1) {
          dispatch({
            type: 'SPLIT_CLIP',
            payload: {
              clipId: state.selectedClipIds[0],
              splitTime: state.playheadPosition,
            },
          });
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, state.isPlaying, state.selectedClipIds, state.playheadPosition]);

  return null;
}

function App() {
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <ProjectProvider>
      <EditorShortcuts />
      <TopBar onExport={() => setExportOpen(true)} />
      <div className="editor-layout">
        <Sidebar />
        <PreviewPanel />
      </div>
      <TimelinePanel />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </ProjectProvider>
  );
}

export default App;
