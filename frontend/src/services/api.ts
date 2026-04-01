const API_BASE = '/api';

export interface MediaMetadata {
  id: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  codec: string | null;
}

export interface ExportStatus {
  job_id: string;
  status: string;
  progress: number;
  error: string | null;
}

export interface ClipDef {
  media_id: string;
  source_start: number;
  source_end: number;
  timeline_start: number;
}

export interface TrackDef {
  track_id: string;
  clips: ClipDef[];
}

export interface ExportRequest {
  tracks: TrackDef[];
  output_format: string;
}

export async function uploadMedia(file: File): Promise<MediaMetadata> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/media/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function startExport(req: ExportRequest): Promise<{ job_id: string }> {
  const res = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Export failed');
  }
  return res.json();
}

export function subscribeExportProgress(
  jobId: string,
  onUpdate: (status: ExportStatus) => void,
  onError: (err: string) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/export/${jobId}/progress`);
  es.onmessage = (event) => {
    try {
      const data: ExportStatus = JSON.parse(event.data);
      onUpdate(data);
      if (data.status === 'done' || data.status === 'error') {
        es.close();
      }
    } catch {
      // ignore parse errors
    }
  };
  es.onerror = () => {
    onError('Connection lost');
    es.close();
  };
  return () => es.close();
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/export/${jobId}/download`;
}
