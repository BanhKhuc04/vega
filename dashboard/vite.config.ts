import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2020', chunkSizeWarningLimit: 400 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
