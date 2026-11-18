import { defineConfig } from '@playwright/test';

// Chromium is pre-installed in the dev container; elsewhere, drop the executablePath override
// and run `npx playwright install chromium`.
const executablePath = process.env.CHROMIUM_PATH || (process.env.CI ? undefined : '/opt/pw-browsers/chromium');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: { executablePath, args: ['--no-sandbox'] },
  },
  webServer: [
    { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    ...(process.env.MQTT_E2E
      ? [{ command: 'npx vite --port 5174 --strictPort', url: 'http://localhost:5174', env: { VITE_DATA_SOURCE: 'mqtt', VITE_MQTT_URL: 'ws://localhost:9001' }, reuseExistingServer: false, timeout: 60_000 }]
      : []),
  ],
});
