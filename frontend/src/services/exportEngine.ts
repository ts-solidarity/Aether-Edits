import type { ExportMessage, ExportRequest } from '../workers/ffmpeg.worker';

let worker: Worker | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/ffmpeg.worker.ts', import.meta.url), {
    type: 'module',
  });
  return worker;
}

export interface ExportCallbacks {
  onLoading?: () => void;
  onLoaded?: () => void;
  onProbed?: (mediaId: string, hasAudio: boolean) => void;
  onProgress?: (fraction: number) => void;
}

/** Runs a single export through the singleton FFmpeg worker. */
export function runExport(req: ExportRequest, cb: ExportCallbacks = {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    const handleMessage = (ev: MessageEvent<ExportMessage>) => {
      const m = ev.data;
      switch (m.type) {
        case 'loading':
          cb.onLoading?.();
          break;
        case 'loaded':
          cb.onLoaded?.();
          break;
        case 'probed':
          cb.onProbed?.(m.mediaId, m.hasAudio);
          break;
        case 'progress':
          cb.onProgress?.(m.fraction);
          break;
        case 'done':
          w.removeEventListener('message', handleMessage);
          resolve(new Blob([m.output], { type: 'video/mp4' }));
          break;
        case 'error':
          w.removeEventListener('message', handleMessage);
          reject(new Error(m.message));
          break;
      }
    };

    w.addEventListener('message', handleMessage);
    w.postMessage(req);
  });
}

/** Heuristic memory ceiling for the FFmpeg.wasm instance (input files + output). */
export function getMemoryCeilingBytes(): number {
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  return isSafari ? 800 * 1024 * 1024 : 1.5 * 1024 * 1024 * 1024;
}
