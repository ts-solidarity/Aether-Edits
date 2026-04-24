import type { Clip, MediaFile, MediaStatus } from '../types/project';

export type Action =
  | { type: 'ADD_MEDIA_FILE'; payload: MediaFile }
  | { type: 'MEDIA_HYDRATED'; payload: { id: string; file: File; objectUrl: string } }
  | { type: 'SET_MEDIA_STATUS'; payload: { id: string; status: MediaStatus } }
  | { type: 'SET_MEDIA_HAS_AUDIO'; payload: { id: string; hasAudio: boolean } }
  | { type: 'ADD_CLIP'; payload: { clip: Clip; trackId: string } }
  | { type: 'SPLIT_CLIP'; payload: { clipId: string; splitTime: number } }
  | { type: 'DELETE_CLIP'; payload: { clipId: string } }
  | { type: 'MOVE_CLIP'; payload: { clipId: string; newTimelineStart: number; newTrackId?: string } }
  | { type: 'ADD_TRACK'; payload: { name: string } }
  | { type: 'REMOVE_TRACK'; payload: { trackId: string } }
  | { type: 'SET_PLAYHEAD'; payload: number }
  | { type: 'SET_PLAYING'; payload: boolean }
  | { type: 'SET_ZOOM'; payload: number }
  | { type: 'SELECT_CLIP'; payload: string[] }
  | { type: 'UNDO' }
  | { type: 'REDO' };
