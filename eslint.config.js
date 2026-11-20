import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  { ignores: ['**/dist/', '**/node_modules/', '**/test-results/', '**/playwright-report/', 'docs/screenshots/', '**/.venv/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // Legacy JS from the design template: keep it as delivered, lint only for real mistakes.
    files: ['dashboard/src/*.js'],
    rules: {
      'no-empty': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      '@typescript-eslint/no-unused-expressions': 'off', // the template uses `cond && fn()`
      'no-useless-escape': 'off',
    },
  },
);
