export type MediaStatus = 'ready' | 'hydrating' | 'missing';

export interface MediaFile {
  id: string;
  name: string;
  objectUrl: string;
  file: File | null;
  duration: number;
  width: number;
  height: number;
  status: MediaStatus;
  hasAudio: boolean;
}

/** Center-anchored normalized transform applied to any clip. */
export interface Transform {
  x: number;        // 0..1, 0.5 = canvas horizontal center
  y: number;        // 0..1, 0.5 = canvas vertical center
  scale: number;    // 1 = clip's default size; for video, 1 = letterbox-fit; for text, multiplies fontSize-derived px
  rotation: number; // degrees, positive = clockwise
}

export const DEFAULT_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };

/** Kept for v2→v3 migration only. Do not use on new clips. */
export type TextPosition = 'top' | 'center' | 'bottom';

export type TransitionKind =
  | 'fade'
  | 'fadeblack'
  | 'fadewhite'
  | 'dissolve'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'circleopen'
  | 'circleclose'
  | 'pixelize'
  | 'radial';

export interface TransitionOut {
  kind: TransitionKind;
  duration: number; // seconds
}

export interface ColorAdjust {
  brightness: number;  // -1..1, 0 = no-op
  contrast: number;    // 0..2, 1 = no-op
  saturation: number;  // 0..3, 1 = no-op
  hue: number;         // -180..180 degrees, 0 = no-op
}

export const NEUTRAL_COLOR: ColorAdjust = { brightness: 0, contrast: 1, saturation: 1, hue: 0 };

export type VideoFit = 'contain' | 'cover' | 'free';

export interface VideoClip {
  id: string;
  kind: 'video';
  mediaFileId: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  trackId: string;
  volume: number; // 0..1
  muted: boolean;
  pan: number; // -1 = full left, 0 = center, 1 = full right
  duckSourceClipId: string | null;
  duckAmount: number; // 0..1, attenuation when ducking active
  fit: VideoFit;
  transform: Transform;
  color: ColorAdjust | null;
  transitionOut: TransitionOut | null;
}

export interface TextClip {
  id: string;
  kind: 'text';
  // Kept parallel to VideoClip so drag/trim/snap share code paths.
  // sourceStart is always 0; sourceEnd is the clip duration.
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  trackId: string;
  text: string;
  color: string;
  fontSize: number; // % of canvas height, e.g. 8 = 8% of H
  transform: Transform;
  transitionOut: TransitionOut | null;
}

export type Clip = VideoClip | TextClip;

/** Duration on the timeline, in seconds. */
export function clipDuration(clip: Clip): number {
  return clip.sourceEnd - clip.sourceStart;
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
