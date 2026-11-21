import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    // two pages: the VEGA screen and the Console (M8)
    rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), console: fileURLToPath(new URL('console.html', import.meta.url)) } },
  },
});
