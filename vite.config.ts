import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/; a relative base works for any repo name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: 'index.html' } },
  },
  server: { host: true },
});
