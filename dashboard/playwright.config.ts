import { defineConfig } from '@playwright/test';

// In the cloud dev container Chromium is pre-installed; elsewhere (CI) leave CHROMIUM_PATH unset and
// run `npx playwright install --with-deps chromium`.
const executablePath = process.env.CHROMIUM_PATH || (process.env.CI ? undefined : '/opt/pw-browsers/chromium');

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: {
      executablePath,
      // software WebGL so the `full` and `lite` tiers can be exercised without a GPU
      // plus a fake microphone (a tone) for push-to-talk, M5
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false, // always build and serve the current sources
    timeout: 180_000,
  },
});
