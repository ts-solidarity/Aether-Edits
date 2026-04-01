import { useState, useCallback, useRef } from 'react';
import type { ProjectState } from '../types/project';
import {
  uploadMedia,
  startExport,
  subscribeExportProgress,
  getDownloadUrl,
  type ExportStatus,
  type TrackDef,
} from '../services/api';
import type { Action } from '../state/actions';

export type ExportPhase = 'idle' | 'uploading' | 'exporting' | 'done' | 'error';

interface ExportState {
  phase: ExportPhase;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
}

export function useExport(state: ProjectState, dispatch: React.Dispatch<Action>) {
  const [exportState, setExportState] = useState<ExportState>({
    phase: 'idle',
    progress: 0,
    error: null,
    downloadUrl: null,
  });
  const unsubRef = useRef<(() => void) | null>(null);

  const reset = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    setExportState({ phase: 'idle', progress: 0, error: null, downloadUrl: null });
  }, []);

  const startExportFlow = useCallback(async () => {
    try {
      // Phase 1: Upload any files not yet on the server
      setExportState({ phase: 'uploading', progress: 0, error: null, downloadUrl: null });

      const toUpload = Object.values(state.mediaFiles).filter((m) => !m.uploaded);
      const total = toUpload.length;

      for (let i = 0; i < toUpload.length; i++) {
        const media = toUpload[i];
        const result = await uploadMedia(media.file);
        dispatch({
          type: 'MARK_MEDIA_UPLOADED',
          payload: { id: media.id, backendId: result.id },
        });
        // Update the local mapping immediately
        media.uploaded = true;
        media.backendId = result.id;
        setExportState((s) => ({ ...s, progress: ((i + 1) / total) * 100 }));
      }

      // Phase 2: Build EDL and start export
      setExportState({ phase: 'exporting', progress: 0, error: null, downloadUrl: null });

      // Build backend media ID map
      const mediaIdMap: Record<string, string> = {};
      for (const m of Object.values(state.mediaFiles)) {
        if (m.backendId) mediaIdMap[m.id] = m.backendId;
      }

      const tracks: TrackDef[] = state.trackOrder
        .map((trackId) => {
          const track = state.tracks[trackId];
          return {
            track_id: trackId,
            clips: track.clips
              .map((clipId) => state.clips[clipId])
              .filter(Boolean)
              .sort((a, b) => a.timelineStart - b.timelineStart)
              .map((clip) => ({
                media_id: mediaIdMap[clip.mediaFileId] || clip.mediaFileId,
                source_start: clip.sourceStart,
                source_end: clip.sourceEnd,
                timeline_start: clip.timelineStart,
              })),
          };
        })
        .filter((t) => t.clips.length > 0);

      if (tracks.length === 0) {
        setExportState({ phase: 'error', progress: 0, error: 'No clips to export', downloadUrl: null });
        return;
      }

      const { job_id } = await startExport({ tracks, output_format: 'mp4' });

      // Phase 3: Listen for progress
      const unsub = subscribeExportProgress(
        job_id,
        (status: ExportStatus) => {
          if (status.status === 'done') {
            setExportState({
              phase: 'done',
              progress: 100,
              error: null,
              downloadUrl: getDownloadUrl(job_id),
            });
          } else if (status.status === 'error') {
            setExportState({
              phase: 'error',
              progress: 0,
              error: status.error || 'Export failed',
              downloadUrl: null,
            });
          } else {
            setExportState((s) => ({
              ...s,
              progress: status.progress * 100,
            }));
          }
        },
        (err) => {
          setExportState({ phase: 'error', progress: 0, error: err, downloadUrl: null });
        },
      );
      unsubRef.current = unsub;
    } catch (err) {
      setExportState({
        phase: 'error',
        progress: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
        downloadUrl: null,
      });
    }
  }, [state, dispatch]);

  return { exportState, startExportFlow, reset };
}
