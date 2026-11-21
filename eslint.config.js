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
      // Rules from docs/contract.md and docs/security.md, enforced instead of only written down.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]',
          message: 'contract.md: network text goes in as text, never HTML. Use textContent / DOM calls.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML'], CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
          message: 'contract.md: network text goes in as text, never HTML. Use textContent / DOM calls.',
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name='open'][arguments.length<3]",
          message: "security.md §7: open links with window.open(url, '_blank', 'noopener,noreferrer').",
        },
        {
          selector: "CallExpression[callee.object.name='console'] MemberExpression[object.object.name='process'][object.property.name='env']",
          message: 'security.md §4: keys and tokens never go into logs. Do not log process.env values.',
        },
        {
          selector: 'Literal[value=/format=(full|raw)/], TemplateElement[value.raw=/format=(full|raw)/]',
          message: 'security.md §6: Gmail is read with format=metadata only; the body is never fetched.',
        },
      ],
    },
  },
  {
    // Tests build DOM fixtures from HTML strings.
    files: ['**/tests/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Legacy JS from the design template: keep it as delivered, lint only for real mistakes.
    files: ['dashboard/src/*.js'],
    rules: {
      'no-empty': 'off',
      'no-restricted-syntax': 'off', // its innerHTML holds only the template's own markup and numbers
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      '@typescript-eslint/no-unused-expressions': 'off', // the template uses `cond && fn()`
      'no-useless-escape': 'off',
    },
  },
);
