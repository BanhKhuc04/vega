// Bundles the brain into one file so the runtime image needs nothing but Node (no node_modules, small on a Pi 3).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here('./src/main.ts')],
  outfile: here('./dist/brain.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CommonJS dependencies (mqtt's deps) call require() for Node built-ins
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  minify: true,
  keepNames: true,
  logLevel: 'info',
});
