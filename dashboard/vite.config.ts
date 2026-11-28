import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    // three pages: the VEGA screen, the Console (M8) and the small knob-driven front screen of the homeserver box
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        console: fileURLToPath(new URL('console.html', import.meta.url)),
        mini: fileURLToPath(new URL('mini.html', import.meta.url)),
      },
    },
  },
});
