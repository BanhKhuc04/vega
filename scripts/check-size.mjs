// Fails when the JavaScript of the production build exceeds the budget (gzip, fonts and CSS not counted).
// Budget: Decision Brief 0003, "JS <= 300 KB gzip".
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const LIMIT_KB = Number(process.env.JS_BUDGET_KB ?? 300);
const dir = new URL('../dashboard/dist/assets/', import.meta.url).pathname;
if (!existsSync(dir)) {
  console.error('dashboard/dist/assets not found: run `npm run build` first');
  process.exit(2);
}
let total = 0;
const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
  const raw = readFileSync(join(dir, f));
  const gz = gzipSync(raw, { level: 9 }).length;
  total += gz;
  rows.push([f, raw.length, gz]);
}
for (const [f, raw, gz] of rows) console.log(`${f.padEnd(40)} ${(raw / 1024).toFixed(1).padStart(8)} KB  ${(gz / 1024).toFixed(1).padStart(7)} KB gzip`);
const kb = total / 1024;
console.log(`total JS: ${kb.toFixed(1)} KB gzip (budget ${LIMIT_KB} KB)`);
if (kb > LIMIT_KB) {
  console.error('JS budget exceeded');
  process.exit(1);
}
