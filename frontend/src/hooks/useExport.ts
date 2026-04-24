import { useState, useCallback, useRef, useMemo } from 'react';
import { useProject } from '../state/ProjectContext';
import { getMemoryCeilingBytes, runExport } from '../services/exportEngine';
import {
  computeCanvas,
  computeTimelineDuration,
  type ExportTrack,
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
    for (const clip of Object.values(state.clips)) ids.add(clip.mediaFileId);
    return ids;
  }, [state.clips]);

  const readiness = useMemo(() => {
    let hydrating = 0;
    let missing = 0;
    for (const id of referencedMediaIds) {
      const m = state.mediaFiles[id];
      if (!m) continue;
      if (m.status === 'hydrating') hydrating++;
      else if (m.status === 'missing') missing++;
    }
    return {
      hasClips: referencedMediaIds.size > 0,
      hydrating,
      missing,
      allReady: referencedMediaIds.size > 0 && hydrating === 0 && missing === 0,
    };
  }, [referencedMediaIds, state.mediaFiles]);

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
        // Resolve Files + gather metadata for involved media only.
        const involvedIds: string[] = [];
        for (const id of referencedMediaIds) {
          const m = state.mediaFiles[id];
          if (m && m.file) involvedIds.push(id);
        }
        if (involvedIds.length === 0) {
          setExportState({ phase: 'error', progress: 0, error: 'No playable media in project', downloadUrl: null });
          return;
        }

        // Memory ceiling pre-check (input files only; output comparable).
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

        // Build input mapping: mediaId -> logical name used in FFmpeg FS.
        const mediaInputNames: Record<string, string> = {};
        const files: { logicalName: string; mediaId: string; file: File }[] = [];
        const mediaHasAudio: Record<string, boolean> = {};
        const probeMediaIds: string[] = [];
        involvedIds.forEach((id, idx) => {
          const m = state.mediaFiles[id]!;
          const ext = m.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '.mp4';
          const logicalName = `input_${idx}${ext}`;
          mediaInputNames[id] = logicalName;
          mediaHasAudio[id] = m.hasAudio;
          probeMediaIds.push(id); // probe every time — cheap, authoritative
          files.push({ logicalName, mediaId: id, file: m.file! });
        });

        // Build TrackDef[] — clips sorted by timeline_start within each track, filter to involved media only.
        const tracks: ExportTrack[] = state.trackOrder
          .map((trackId) => {
            const track = state.tracks[trackId];
            return {
              trackId,
              clips: track.clips
                .map((cid) => state.clips[cid])
                .filter(Boolean)
                .filter((c) => mediaInputNames[c.mediaFileId])
                .sort((a, b) => a.timelineStart - b.timelineStart)
                .map((c) => ({
                  mediaId: c.mediaFileId,
                  sourceStart: c.sourceStart,
                  sourceEnd: c.sourceEnd,
                  timelineStart: c.timelineStart,
                })),
            };
          })
          .filter((t) => t.clips.length > 0);

        if (tracks.length === 0) {
          setExportState({ phase: 'error', progress: 0, error: 'No clips to export', downloadUrl: null });
          return;
        }

        const involvedMedia = involvedIds.map((id) => state.mediaFiles[id]!);
        const canvas = computeCanvas(involvedMedia);
        const timelineDuration = computeTimelineDuration(tracks);

        setExportState({ phase: 'loading-core', progress: 0, error: null, downloadUrl: null });

        const blob = await runExport(
          {
            type: 'export',
            files,
            tracks,
            mediaInputNames,
            mediaHasAudio,
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
