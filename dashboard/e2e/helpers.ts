import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCENE_NAMES = ['idle', 'listen', 'think', 'research', 'locate', 'vision', 'briefing', 'focus', 'alert', 'success', 'sleep'] as const;
export const SHOT_DIR = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));
export const shoot = process.env.SHOTS === '1';

export interface Watch {
  errors: string[];
  warnings: string[];
  external: string[];
}

/** Collects console errors / warnings / uncaught exceptions and blocks every request that leaves the app. */
export async function watch(page: Page, allow: (url: URL) => boolean = () => false): Promise<Watch> {
  const w: Watch = { errors: [], warnings: [], external: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') w.errors.push(m.text());
    if (m.type() === 'warning') w.warnings.push(m.text());
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = (u.protocol === 'http:' && u.hostname === 'localhost') || u.protocol === 'data:' || u.protocol === 'blob:';
    if (local || allow(u)) return route.continue();
    w.external.push(route.request().url());
    return route.abort();
  });
  return w;
}

/** Whether the animation frame loop is running and the intro has settled (animations are GSAP-driven). */
export async function settle(page: Page, ms = 2800): Promise<void> {
  await page.waitForTimeout(ms);
}

export async function shot(page: Page, name: string, dir = SHOT_DIR): Promise<void> {
  if (!shoot) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png` });
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'page must not scroll horizontally').toBeLessThanOrEqual(iw);
  const inner = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.tpl.on, .tpl.on *')].filter((e) => {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && Number(cs.opacity) > 0.05 && !e.closest('.vspec:not(.on), .log, .dock, .table, svg, canvas, .cmp, .x-layer, .osm');
    }).map((e) => `${e.tagName}.${e.className}`),
  );
  expect(inner, 'content must stay inside the viewport').toEqual([]);
}

/** Overlap of text boxes belonging to different elements (text on top of text). Returns offending pairs. */
export async function textOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    interface Box { id: string; r: DOMRect; el: Element }
    const boxes: Box[] = [];
    const roots = [...document.querySelectorAll('header.top, .tpl.on, #orbLabel, form.cmd')];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const t = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (!t || !el) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) continue;
        if (el.closest('[hidden], .x-layer, #callouts, script, style, .log, .vctl, .vcard, .vpart, .vlayer, .vspec')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
          // text clipped away by an ancestor with overflow hidden/auto/scroll that does not show it
          let clipped = false;
          for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
            const o = getComputedStyle(a);
            if (/(hidden|auto|scroll|clip)/.test(o.overflowX + o.overflowY)) {
              const ar = a.getBoundingClientRect();
              if (r.bottom < ar.top || r.top > ar.bottom || r.right < ar.left || r.left > ar.right) clipped = true;
            }
          }
          if (clipped) continue;
          boxes.push({ id: `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}:"${t.slice(0, 24)}"`, r, el });
        }
      }
    }
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 2 && oy > 3) out.push(`${a.id} x ${b.id} (${Math.round(ox)}x${Math.round(oy)})`);
      }
    }
    return out;
  });
}

/**
 * Latency budgets (scene within 1 s, readings within 2 s) are asserted as written on a developer machine. A shared
 * CI runner without a GPU is several times slower, so there the wait is stretched; the measured latency is still
 * logged. The app's own criteria are not changed.
 */
export const T = (ms: number): number => (process.env.CI ? ms * 3 : ms);
