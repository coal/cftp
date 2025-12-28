import { defineConfig } from 'vite';

export default defineConfig({
  // IMPORTANT: packaged Electron loads `dist/index.html` via `file://`.
  // Vite's default base is '/', which makes assets resolve to `file:///assets/...` (white screen).
  // Using a relative base fixes packaged builds.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});


