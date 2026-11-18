import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'dashboard/tests/**/*.test.ts', 'tools/*/tests/**/*.test.ts'],
    environment: 'node',
    // DOM-based tests opt in with a `// @vitest-environment jsdom` comment.
  },
});
