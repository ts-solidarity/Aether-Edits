import type { ProjectState } from '../types/project';
import { initialState } from './reducer';

const KEY = 'montaj:project:v2';
const LEGACY_KEY = 'montaj:project:v1';

interface SerializedMediaFile {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

interface SerializedProject {
  version: 2;
  projectName: string;
  tracks: ProjectState['tracks'];
  clips: ProjectState['clips'];
  trackOrder: string[];
  mediaFiles: Record<string, SerializedMediaFile>;
}

export function serialize(state: ProjectState): string {
  const mediaFiles: Record<string, SerializedMediaFile> = {};
  for (const [id, m] of Object.entries(state.mediaFiles)) {
    mediaFiles[id] = {
      id: m.id,
      name: m.name,
      duration: m.duration,
      width: m.width,
      height: m.height,
      hasAudio: m.hasAudio,
    };
  }
  const payload: SerializedProject = {
    version: 2,
    projectName: state.projectName,
    tracks: state.tracks,
    clips: state.clips,
    trackOrder: state.trackOrder,
    mediaFiles,
  };
  return JSON.stringify(payload);
}

export function deserialize(raw: string): ProjectState | null {
  try {
    const data = JSON.parse(raw) as SerializedProject;
    if (data.version !== 2) return null;

    const mediaFiles: ProjectState['mediaFiles'] = {};
    for (const [id, m] of Object.entries(data.mediaFiles ?? {})) {
      mediaFiles[id] = {
        id: m.id,
        name: m.name,
        duration: m.duration,
        width: m.width,
        height: m.height,
        hasAudio: m.hasAudio ?? true,
        file: null,
        objectUrl: '',
        status: 'hydrating',
      };
    }

    return {
      ...initialState,
      projectName: data.projectName ?? initialState.projectName,
      tracks: data.tracks ?? initialState.tracks,
      clips: data.clips ?? initialState.clips,
      trackOrder: data.trackOrder ?? initialState.trackOrder,
      mediaFiles,
    };
  } catch {
    return null;
  }
}

export function loadProject(): ProjectState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function saveProject(state: ProjectState): void {
  try {
    localStorage.setItem(KEY, serialize(state));
  } catch {
    // quota / disabled
  }
}

export function clearSavedProject(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function migrateLegacyV1(): boolean {
  try {
    if (!localStorage.getItem(LEGACY_KEY)) return false;
    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    return false;
  }
}
