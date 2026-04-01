import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { ProjectState } from '../types/project';
import type { Action } from './actions';
import { type HistoryState, historyReducer } from './history';
import { initialState } from './reducer';

interface ProjectContextValue {
  state: ProjectState;
  dispatch: React.Dispatch<Action>;
  canUndo: boolean;
  canRedo: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const initialHistory: HistoryState = {
  past: [],
  present: initialState,
  future: [],
};

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(historyReducer, initialHistory);

  const value: ProjectContextValue = {
    state: history.present,
    dispatch,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
