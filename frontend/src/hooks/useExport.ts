import { useState, useCallback, useRef, useMemo } from 'react';
import { useProject } from '../state/ProjectContext';
import { getMemoryCeilingBytes, runExport } from '../services/exportEngine';
import {
  computeCanvas,
  computeTimelineDuration,
  type ExportClip,
  type ExportImageClip,
  type ExportTextClip,
  type ExportTrack,
  type ExportVideoClip,
  type QualityPreset,
} from '../services/filterGraph';

export type ExportPhase = 'idle' | 'waiting' | 'loading-core' | 'exporting' | 'done' | 'error';

interface ExportState {
  phase: ExportPhase;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
}

const initial: ExportState = {
  phase: 'idle',
  progress: 0,
  error: null,
  downloadUrl: null,
};

export function useExport() {
  const { state, dispatch } = useProject();
  const [exportState, setExportState] = useState<ExportState>(initial);
  const previousUrlRef = useRef<string | null>(null);

  const referencedMediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const clip of Object.values(state.clips)) {
      if (clip.kind === 'video' || clip.kind === 'image') ids.add(clip.mediaFileId);
    }
    return ids;
  }, [state.clips]);

  const readiness = useMemo(() => {
    let hydrating = 0;
    let missing = 0;
    let orphan = 0;
    for (const id of referencedMediaIds) {
      const m = state.mediaFiles[id];
      if (!m) {
        // Clip references a media record that doesn't exist anymore.
        orphan++;
        continue;
      }
      if (m.status === 'hydrating') hydrating++;
      else if (m.status === 'missing') missing++;
      else if (!m.file) {
        // Ready but no in-memory File — cannot feed FFmpeg. Count as missing.
        missing++;
      }
    }
    const hasClips = Object.keys(state.clips).length > 0;
    return {
      hasClips,
      hydrating,
      missing: missing + orphan,
      allReady: hasClips && hydrating === 0 && missing === 0 && orphan === 0,
    };
  }, [referencedMediaIds, state.mediaFiles, state.clips]);

  const revokeDownloadUrl = useCallback(() => {
    if (previousUrlRef.current) {
      URL.revokeObjectURL(previousUrlRef.current);
      previousUrlRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    revokeDownloadUrl();
    setExportState(initial);
  }, [revokeDownloadUrl]);

  const startExportFlow = useCallback(
    async (quality: QualityPreset = 'fast') => {
      if (!readiness.hasClips) {
        setExportState({ phase: 'error', progress: 0, error: 'No clips to export', downloadUrl: null });
        return;
      }
      if (readiness.missing > 0) {
        setExportState({
          phase: 'error',
          progress: 0,
          error: `${readiness.missing} media file${readiness.missing > 1 ? 's are' : ' is'} missing — re-import before exporting.`,
          downloadUrl: null,
        });
        return;
      }
      if (readiness.hydrating > 0) {
        setExportState({ phase: 'waiting', progress: 0, error: null, downloadUrl: null });
        return;
      }

      revokeDownloadUrl();

      try {
        // Involved video media (text clips need no media).
        const involvedIds: string[] = [];
        for (const id of referencedMediaIds) {
          const m = state.mediaFiles[id];
          if (m && m.file) involvedIds.push(id);
        }

        // Memory ceiling pre-check.
        const ceiling = getMemoryCeilingBytes();
        let totalSize = 0;
        for (const id of involvedIds) {
          const m = state.mediaFiles[id];
          if (m?.file) totalSize += m.file.size;
        }
        if (totalSize > ceiling) {
          const mb = Math.round(totalSize / (1024 * 1024));
          const cap = Math.round(ceiling / (1024 * 1024));
          setExportState({
            phase: 'error',
            progress: 0,
            error: `Project too large (${mb} MB). FFmpeg.wasm can't handle more than ~${cap} MB of input on this browser. Split the project and export in sections.`,
            downloadUrl: null,
          });
          return;
        }

        const mediaInputNames: Record<string, string> = {};
        const files: { logicalName: string; mediaId: string; file: File }[] = [];
        const mediaHasAudio: Record<string, boolean> = {};
        const mediaKinds: Record<string, 'video' | 'image'> = {};
        const probeMediaIds: string[] = [];
        involvedIds.forEach((id, idx) => {
          const m = state.mediaFiles[id]!;
          const ext = m.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '.mp4';
          const logicalName = `input_${idx}${ext}`;
          mediaInputNames[id] = logicalName;
          mediaHasAudio[id] = m.kind === 'image' ? false : m.hasAudio;
          mediaKinds[id] = m.kind;
          // Image media don't have audio streams, so skip the probe entirely
          // — ffmpeg -i on an image generates noisy logs.
          if (m.kind === 'video') probeMediaIds.push(id);
          files.push({ logicalName, mediaId: id, file: m.file! });
        });

        // Build ExportTracks — sorted by timeline_start. The export pipeline
        // groups adjacent transition-linked video clips into xfade runs internally.
        const skippedClips: string[] = [];
        const tracks: ExportTrack[] = state.trackOrder
          .map((trackId) => {
            const track = state.tracks[trackId];
            const sorted = track.clips
              .map((cid) => state.clips[cid])
              .filter(Boolean)
              .sort((a, b) => a.timelineStart - b.timelineStart);

            const out: ExportClip[] = [];

            for (const c of sorted) {
              if (c.kind === 'video') {
                if (!mediaInputNames[c.mediaFileId]) {
                  skippedClips.push(c.id);
                  continue;
                }

                const exp: ExportVideoClip = {
                  kind: 'video',
                  id: c.id,
                  mediaId: c.mediaFileId,
                  sourceStart: c.sourceStart,
                  sourceEnd: c.sourceEnd,
                  timelineStart: c.timelineStart,
                  volume: c.volume,
                  muted: c.muted,
                  pan: c.pan,
                  duckSourceClipId: c.duckSourceClipId,
                  duckAmount: c.duckAmount,
                  fit: c.fit,
                  transform: c.transform,
                  color: c.color,
                  speed: c.speed,
                  transitionOut: c.transitionOut,
                };
                out.push(exp);
              } else if (c.kind === 'image') {
                if (!mediaInputNames[c.mediaFileId]) {
                  skippedClips.push(c.id);
                  continue;
                }
                const exp: ExportImageClip = {
                  kind: 'image',
                  id: c.id,
                  mediaId: c.mediaFileId,
                  sourceStart: 0,
                  sourceEnd: c.sourceEnd,
                  timelineStart: c.timelineStart,
                  fit: c.fit,
                  transform: c.transform,
                  color: c.color,
                  speed: c.speed,
                  transitionOut: c.transitionOut,
                };
                out.push(exp);
              } else {
                const exp: ExportTextClip = {
                  kind: 'text',
                  id: c.id,
                  text: c.text,
                  color: c.color,
                  fontSize: c.fontSize,
                  fontFamily: c.fontFamily,
                  transform: c.transform,
                  speed: c.speed,
                  timelineStart: c.timelineStart,
                  sourceStart: c.sourceStart,
                  sourceEnd: c.sourceEnd,
                };
                out.push(exp);
              }
            }

            return { trackId, clips: out };
          })
          .filter((t) => t.clips.length > 0);

        if (skippedClips.length > 0) {
          setExportState({
            phase: 'error',
            progress: 0,
            error: `${skippedClips.length} video clip(s) reference media that isn't available. Re-import the missing file(s) or delete those clips and try again.`,
            downloadUrl: null,
          });
          return;
        }

        if (tracks.length === 0) {
          setExportState({ phase: 'error', progress: 0, error: 'No clips to export', downloadUrl: null });
          return;
        }

        const involvedMedia = involvedIds.map((id) => state.mediaFiles[id]!);
        // Project canvas drives both preview and export — WYSIWYG. If the
        // project canvas is somehow invalid, fall back to source-derived dims.
        const canvas: [number, number] =
          state.canvas.width > 0 && state.canvas.height > 0
            ? [state.canvas.width, state.canvas.height]
            : computeCanvas(involvedMedia);
        const timelineDuration = computeTimelineDuration(tracks);

        setExportState({ phase: 'loading-core', progress: 0, error: null, downloadUrl: null });

        const blob = await runExport(
          {
            type: 'export',
            files,
            tracks,
            mediaInputNames,
            mediaHasAudio,
            mediaKinds,
            probeMediaIds,
            canvas,
            timelineDuration,
            quality,
          },
          {
            onLoaded: () => {
              setExportState((s) => (s.phase === 'loading-core' ? { ...s, phase: 'exporting' } : s));
            },
            onProbed: (mediaId, hasAudio) => {
              dispatch({ type: 'SET_MEDIA_HAS_AUDIO', payload: { id: mediaId, hasAudio } });
            },
            onProgress: (fraction) => {
              setExportState((s) => ({ ...s, progress: fraction * 100 }));
            },
          }
        );

        const url = URL.createObjectURL(blob);
        previousUrlRef.current = url;
        setExportState({ phase: 'done', progress: 100, error: null, downloadUrl: url });
      } catch (err) {
        setExportState({
          phase: 'error',
          progress: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
          downloadUrl: null,
        });
      }
    },
    [readiness, referencedMediaIds, state, dispatch, revokeDownloadUrl]
  );

  return { exportState, startExportFlow, reset, readiness };
}
