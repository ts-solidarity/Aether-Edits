import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App.tsx';

if (import.meta.env.DEV && typeof window !== 'undefined' && !window.crossOriginIsolated) {
  // Multi-threaded FFmpeg.wasm needs COOP/COEP headers. Phase 1 uses the
  // single-threaded core, so this is an early-warning check rather than a
  // hard requirement — but fixing it now keeps the later flip to MT easy.
  console.warn(
    '[montaj] crossOriginIsolated=false — COOP/COEP headers not active. ' +
      'Check vite.config.ts server.headers and any external resources loaded from index.html/globals.css.'
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
