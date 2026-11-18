// Side-by-side screenshots: the original template (git ref `design/final:vega/`) next to this dashboard, same scene,
// same viewport. Output: docs/screenshots/m0/compare/<viewport>-<scene>.png (left = template, right = dashboard).
//   npm run compare                       # all scenes, 1440x900 and 390x844
//   npm run compare -- research,alert     # some scenes
// Both sides use the same self-hosted fonts, so only real differences show. Animations are time-based and
// partly random (particles, typing), so frames are similar, not pixel-identical.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const REF = process.env.TEMPLATE_REF ?? (existsSync(join(root, '.git')) ? 'origin/design/final' : 'design/final');
const ALL = ['idle', 'listen', 'think', 'research', 'locate', 'vision', 'briefing', 'focus', 'alert', 'success', 'sleep'];
const scenes = process.argv[2] ? process.argv[2].split(',') : ALL;
const out = join(root, 'docs/screenshots/m0/compare');
mkdirSync(out, { recursive: true });

// 1. the template, with its Google Fonts replaced by the same @fontsource files the dashboard uses
const tmp = mkdtempSync(join(tmpdir(), 'vega-tpl-'));
execFileSync('sh', ['-c', `git -C "${root}" archive ${REF} vega | tar -x -C "${tmp}"`]);
const tpl = join(tmp, 'vega');
symlinkSync(join(root, 'node_modules'), join(tpl, 'node_modules'));
let html = readFileSync(join(tpl, 'index.html'), 'utf8');
html = html.replace(/<link rel="preconnect"[^>]*>\s*<link rel="stylesheet" href="https:\/\/fonts[^>]*>/, '');
html = html.replace('<script type="module" src="/src/main.js">', '<script type="module" src="/src/fonts.js"></script><script type="module" src="/src/main.js">');
writeFileSync(join(tpl, 'index.html'), html);
writeFileSync(
  join(tpl, 'src/fonts.js'),
  ['michroma/400', 'chakra-petch/latin-500', 'chakra-petch/latin-600', 'chakra-petch/latin-700', 'jetbrains-mono/latin-400', 'jetbrains-mono/latin-500', 'jetbrains-mono/latin-700']
    .map((f) => `import '@fontsource/${f.split('/')[0]}/${f.split('/')[1]}.css';`)
    .join('\n'),
);
writeFileSync(join(tpl, 'vite.config.js'), "export default { server: { fs: { strict: false } }, build: { target: 'es2020' } };\n");

// 2. servers
const vite = join(root, 'node_modules/.bin/vite');
const procs = [];
const serve = (cwd, args, port) => {
  const p = spawn(vite, [...args, '--port', String(port), '--strictPort'], { cwd, stdio: 'ignore' });
  procs.push(p);
};
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
serve(tpl, [], 4180);
serve(join(root, 'dashboard'), ['preview'], 4181);
const until = async (url) => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
};
await until('http://localhost:4180/');
await until('http://localhost:4181/');

// 3. shots
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const a = await ctx.newPage();
    const b = await ctx.newPage();
    const compose = await ctx.newPage();
    for (const s of scenes) {
      await Promise.all([a.goto(`http://localhost:4180/#${s}`), b.goto(`http://localhost:4181/?quality=full#${s}`)]);
      await new Promise((r) => setTimeout(r, 4200));
      const [ia, ib] = await Promise.all([a.screenshot(), b.screenshot()]);
      const data = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
      await compose.setViewportSize({ width: w * 2 + 30, height: h + 40 });
      await compose.setContent(
        `<body style="margin:0;background:#111;color:#9FD6FF;font:12px monospace"><div style="display:flex;gap:30px;padding:20px 0 0"><div><div style="padding:0 0 4px 4px">template (design/final)</div><img src="${data(ia)}"></div><div><div style="padding:0 0 4px 4px">dashboard (this branch) · ${s} · ${tag}</div><img src="${data(ib)}"></div></div></body>`,
      );
      await compose.waitForTimeout(150);
      await compose.screenshot({ path: join(out, `${tag}-${s}.png`) });
      console.log(`compare ${tag}-${s}.png`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  for (const p of procs) p.kill();
  rmSync(tmp, { recursive: true, force: true });
}
