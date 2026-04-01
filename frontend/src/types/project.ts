export interface MediaFile {
  id: string;
  name: string;
  objectUrl: string;
  file: File;
  duration: number;
  width: number;
  height: number;
  uploaded: boolean;
  backendId: string | null;
}

export interface Clip {
  id: string;
  mediaFileId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  trackId: string;
}

export interface Track {
  id: string;
  name: string;
  type: 'video';
  clips: string[];
}

export interface ProjectState {
  projectName: string;
  mediaFiles: Record<string, MediaFile>;
  tracks: Record<string, Track>;
  clips: Record<string, Clip>;
  trackOrder: string[];
  playheadPosition: number;
  isPlaying: boolean;
  zoomLevel: number;
  selectedClipIds: string[];
}
