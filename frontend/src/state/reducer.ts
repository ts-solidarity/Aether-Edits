import type { ProjectState } from '../types/project';
import type { Action } from './actions';
import { newId } from '../utils/id';

export const initialState: ProjectState = {
  projectName: 'Untitled Project',
  mediaFiles: {},
  tracks: {
    'track-1': { id: 'track-1', name: 'Video 1', type: 'video', clips: [] },
  },
  clips: {},
  trackOrder: ['track-1'],
  playheadPosition: 0,
  isPlaying: false,
  zoomLevel: 50,
  selectedClipIds: [],
};

export function projectReducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case 'ADD_MEDIA_FILE':
      return {
        ...state,
        mediaFiles: { ...state.mediaFiles, [action.payload.id]: action.payload },
      };

    case 'MEDIA_HYDRATED': {
      const existing = state.mediaFiles[action.payload.id];
      if (!existing) return state;
      if (existing.status === 'ready' && existing.objectUrl === action.payload.objectUrl) return state;
      return {
        ...state,
        mediaFiles: {
          ...state.mediaFiles,
          [action.payload.id]: {
            ...existing,
            file: action.payload.file,
            objectUrl: action.payload.objectUrl,
            status: 'ready',
          },
        },
      };
    }

    case 'SET_MEDIA_STATUS': {
      const existing = state.mediaFiles[action.payload.id];
      if (!existing || existing.status === action.payload.status) return state;
      return {
        ...state,
        mediaFiles: {
          ...state.mediaFiles,
          [action.payload.id]: { ...existing, status: action.payload.status },
        },
      };
    }

    case 'SET_MEDIA_HAS_AUDIO': {
      const existing = state.mediaFiles[action.payload.id];
      if (!existing || existing.hasAudio === action.payload.hasAudio) return state;
      return {
        ...state,
        mediaFiles: {
          ...state.mediaFiles,
          [action.payload.id]: { ...existing, hasAudio: action.payload.hasAudio },
        },
      };
    }

    case 'ADD_CLIP': {
      const { clip, trackId } = action.payload;
      const track = state.tracks[trackId];
      if (!track) return state;

      // Auto-place after last clip if timelineStart is 0 and track has clips
      let finalClip = clip;
      if (clip.timelineStart === 0 && track.clips.length > 0) {
        let maxEnd = 0;
        for (const cid of track.clips) {
          const c = state.clips[cid];
          if (c) {
            const end = c.timelineStart + (c.sourceEnd - c.sourceStart);
            if (end > maxEnd) maxEnd = end;
          }
        }
        finalClip = { ...clip, timelineStart: maxEnd };
      }

      return {
        ...state,
        clips: { ...state.clips, [finalClip.id]: finalClip },
        tracks: {
          ...state.tracks,
          [trackId]: { ...track, clips: [...track.clips, finalClip.id] },
        },
      };
    }

    case 'SPLIT_CLIP': {
      const { clipId, splitTime } = action.payload;
      const clip = state.clips[clipId];
      if (!clip) return state;

      const clipDuration = clip.sourceEnd - clip.sourceStart;
      const clipEnd = clip.timelineStart + clipDuration;
      if (splitTime <= clip.timelineStart || splitTime >= clipEnd) return state;

      const offsetInClip = splitTime - clip.timelineStart;
      const splitSourceTime = clip.sourceStart + offsetInClip;

      const leftId = newId('clip');
      const rightId = newId('clip');

      const leftClip = { ...clip, id: leftId, sourceEnd: splitSourceTime };
      const rightClip = {
        ...clip,
        id: rightId,
        sourceStart: splitSourceTime,
        timelineStart: splitTime,
      };

      const track = state.tracks[clip.trackId];
      const clipIndex = track.clips.indexOf(clipId);
      const newClipList = [...track.clips];
      newClipList.splice(clipIndex, 1, leftId, rightId);

      const { [clipId]: _, ...restClips } = state.clips;

      return {
        ...state,
        clips: { ...restClips, [leftId]: leftClip, [rightId]: rightClip },
        tracks: {
          ...state.tracks,
          [clip.trackId]: { ...track, clips: newClipList },
        },
        selectedClipIds: [],
      };
    }

    case 'DELETE_CLIP': {
      const { clipId } = action.payload;
      const clip = state.clips[clipId];
      if (!clip) return state;

      const track = state.tracks[clip.trackId];
      const { [clipId]: _, ...restClips } = state.clips;

      return {
        ...state,
        clips: restClips,
        tracks: {
          ...state.tracks,
          [clip.trackId]: {
            ...track,
            clips: track.clips.filter((id) => id !== clipId),
          },
        },
        selectedClipIds: state.selectedClipIds.filter((id) => id !== clipId),
      };
    }

    case 'MOVE_CLIP': {
      const { clipId, newTimelineStart, newTrackId } = action.payload;
      const clip = state.clips[clipId];
      if (!clip) return state;

      const updatedClip = {
        ...clip,
        timelineStart: newTimelineStart,
        trackId: newTrackId ?? clip.trackId,
      };

      let newTracks = state.tracks;
      if (newTrackId && newTrackId !== clip.trackId) {
        const oldTrack = state.tracks[clip.trackId];
        const newTrack = state.tracks[newTrackId];
        if (!newTrack) return state;
        newTracks = {
          ...state.tracks,
          [clip.trackId]: {
            ...oldTrack,
            clips: oldTrack.clips.filter((id) => id !== clipId),
          },
          [newTrackId]: {
            ...newTrack,
            clips: [...newTrack.clips, clipId],
          },
        };
      }

      return {
        ...state,
        clips: { ...state.clips, [clipId]: updatedClip },
        tracks: newTracks,
      };
    }

    case 'ADD_TRACK': {
      const id = newId('track');
      return {
        ...state,
        tracks: {
          ...state.tracks,
          [id]: { id, name: action.payload.name, type: 'video', clips: [] },
        },
        trackOrder: [...state.trackOrder, id],
      };
    }

    case 'REMOVE_TRACK': {
      const { trackId } = action.payload;
      if (state.trackOrder.length <= 1) return state;
      const track = state.tracks[trackId];
      if (!track) return state;

      const { [trackId]: _, ...restTracks } = state.tracks;
      const restClips = { ...state.clips };
      track.clips.forEach((clipId) => delete restClips[clipId]);

      return {
        ...state,
        tracks: restTracks,
        clips: restClips,
        trackOrder: state.trackOrder.filter((id) => id !== trackId),
        selectedClipIds: state.selectedClipIds.filter(
          (id) => !track.clips.includes(id)
        ),
      };
    }

    case 'SET_PLAYHEAD':
      return { ...state, playheadPosition: action.payload };

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.payload };

    case 'SET_ZOOM':
      return { ...state, zoomLevel: action.payload };

    case 'SELECT_CLIP':
      return { ...state, selectedClipIds: action.payload };

    default:
      return state;
  }
}
