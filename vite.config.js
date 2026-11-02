import { defineConfig } from 'vite';

// Plain Vite setup. The page talks to the director at ws://127.0.0.1:8765
// directly from the browser, so no proxy is needed.
export default defineConfig({
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
