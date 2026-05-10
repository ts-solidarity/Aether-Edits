import type { Clip, ColorAdjust, ProjectState, TextPosition, Transform, TransitionKind, TransitionOut, VideoClip, VideoFit } from '../types/project';
import { DEFAULT_TRANSFORM, NEUTRAL_COLOR } from '../types/project';
import { initialState } from './reducer';

const KEY_V3 = 'montaj:project:v3';
const KEY_V2 = 'montaj:project:v2';
const LEGACY_KEY = 'montaj:project:v1';

interface SerializedMediaFile {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

interface SerializedProjectV3 {
  version: 3;
  projectName: string;
  tracks: ProjectState['tracks'];
  clips: ProjectState['clips'];
  trackOrder: string[];
  mediaFiles: Record<string, SerializedMediaFile>;
}

const ALLOWED_TRANSITION_KINDS = new Set<TransitionKind>([
  'fade', 'fadeblack', 'fadewhite', 'dissolve',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circleopen', 'circleclose', 'pixelize', 'radial',
]);

const ALLOWED_FITS = new Set<VideoFit>(['contain', 'cover', 'free']);

function safeTransform(input: unknown): Transform {
  const t = (input ?? {}) as Partial<Transform>;
  return {
    x: typeof t.x === 'number' ? t.x : DEFAULT_TRANSFORM.x,
    y: typeof t.y === 'number' ? t.y : DEFAULT_TRANSFORM.y,
    scale: typeof t.scale === 'number' && t.scale > 0 ? t.scale : DEFAULT_TRANSFORM.scale,
    rotation: typeof t.rotation === 'number' ? t.rotation : DEFAULT_TRANSFORM.rotation,
  };
}

function safeColor(input: unknown): ColorAdjust | null {
  if (input == null) return null;
  const c = input as Partial<ColorAdjust>;
  return {
    brightness: typeof c.brightness === 'number' ? c.brightness : NEUTRAL_COLOR.brightness,
    contrast: typeof c.contrast === 'number' ? c.contrast : NEUTRAL_COLOR.contrast,
    saturation: typeof c.saturation === 'number' ? c.saturation : NEUTRAL_COLOR.saturation,
    hue: typeof c.hue === 'number' ? c.hue : NEUTRAL_COLOR.hue,
  };
}

function safeTransition(input: unknown): TransitionOut | null {
  if (input == null) return null;
  const t = input as Partial<TransitionOut> & { kind?: string };
  // Legacy v2 stored kind: 'crossfade' — map to 'fade'.
  let kind: TransitionKind = 'fade';
  if (typeof t.kind === 'string' && ALLOWED_TRANSITION_KINDS.has(t.kind as TransitionKind)) {
    kind = t.kind as TransitionKind;
  }
  const duration = typeof t.duration === 'number' && t.duration > 0 ? t.duration : 1;
  return { kind, duration };
}

function safeFit(input: unknown): VideoFit {
  if (typeof input === 'string' && ALLOWED_FITS.has(input as VideoFit)) {
    return input as VideoFit;
  }
  return 'contain';
}

/** v2 stored TextClip.position; v3 uses transform. Convert preset → normalized y. */
function transformFromLegacyPosition(pos: TextPosition | undefined): Transform {
  if (pos === 'top') return { x: 0.5, y: 0.05, scale: 1, rotation: 0 };
  if (pos === 'bottom') return { x: 0.5, y: 0.95, scale: 1, rotation: 0 };
  return { ...DEFAULT_TRANSFORM };
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
  const payload: SerializedProjectV3 = {
    version: 3,
    projectName: state.projectName,
    tracks: state.tracks,
    clips: state.clips,
    trackOrder: state.trackOrder,
    mediaFiles,
  };
  return JSON.stringify(payload);
}

/** Reads v2 or v3 and returns ProjectState. v2 is migrated up; v3 backfills missing fields. */
export function deserialize(raw: string): ProjectState | null {
  try {
    const data = JSON.parse(raw) as { version?: number };
    if (data.version !== 2 && data.version !== 3) return null;

    const fromV2 = data.version === 2;
    const d = data as unknown as SerializedProjectV3 & { mediaFiles?: Record<string, SerializedMediaFile> };

    const mediaFiles: ProjectState['mediaFiles'] = {};
    for (const [id, m] of Object.entries(d.mediaFiles ?? {})) {
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

    const clips: Record<string, Clip> = {};
    for (const [id, rawClip] of Object.entries((d.clips ?? {}) as Record<string, Partial<Clip> & Record<string, unknown>>)) {
      const kind = (rawClip.kind as Clip['kind']) ?? 'video';
      const transitionOut = safeTransition(rawClip.transitionOut);

      if (kind === 'text') {
        const transform = fromV2
          ? transformFromLegacyPosition(rawClip.position as TextPosition | undefined)
          : safeTransform(rawClip.transform);

        clips[id] = {
          id,
          kind: 'text',
          sourceStart: (rawClip.sourceStart as number | undefined) ?? 0,
          sourceEnd: (rawClip.sourceEnd as number | undefined) ?? 3,
          timelineStart: (rawClip.timelineStart as number | undefined) ?? 0,
          trackId: (rawClip.trackId as string | undefined) ?? 'track-1',
          text: (rawClip.text as string | undefined) ?? 'Text',
          color: (rawClip.color as string | undefined) ?? '#ffffff',
          fontSize: (rawClip.fontSize as number | undefined) ?? 8,
          transform,
          transitionOut,
        };
      } else {
        const v = rawClip as Partial<VideoClip> & Record<string, unknown>;
        clips[id] = {
          id,
          kind: 'video',
          mediaFileId: (v.mediaFileId as string | undefined) ?? '',
          sourceStart: (v.sourceStart as number | undefined) ?? 0,
          sourceEnd: (v.sourceEnd as number | undefined) ?? 0,
          timelineStart: (v.timelineStart as number | undefined) ?? 0,
          trackId: (v.trackId as string | undefined) ?? 'track-1',
          volume: (v.volume as number | undefined) ?? 1,
          muted: (v.muted as boolean | undefined) ?? false,
          pan: (v.pan as number | undefined) ?? 0,
          duckSourceClipId: (v.duckSourceClipId as string | null | undefined) ?? null,
          duckAmount: (v.duckAmount as number | undefined) ?? 0.6,
          fit: safeFit(v.fit),
          transform: safeTransform(v.transform),
          color: safeColor(v.color),
          transitionOut,
        };
      }
    }

    return {
      ...initialState,
      projectName: d.projectName ?? initialState.projectName,
      tracks: d.tracks ?? initialState.tracks,
      clips,
      trackOrder: d.trackOrder ?? initialState.trackOrder,
      mediaFiles,
    };
  } catch {
    return null;
  }
}

export function loadProject(): ProjectState | null {
  try {
    const v3 = localStorage.getItem(KEY_V3);
    if (v3) return deserialize(v3);

    const v2 = localStorage.getItem(KEY_V2);
    if (v2) {
      const migrated = deserialize(v2);
      if (migrated) {
        try {
          localStorage.setItem(KEY_V3, serialize(migrated));
          localStorage.removeItem(KEY_V2);
        } catch {
          // ignore quota; migration succeeds in-memory either way
        }
        return migrated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveProject(state: ProjectState): void {
  try {
    localStorage.setItem(KEY_V3, serialize(state));
  } catch {
    // quota / disabled
  }
}

export function clearSavedProject(): void {
  try {
    localStorage.removeItem(KEY_V3);
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
