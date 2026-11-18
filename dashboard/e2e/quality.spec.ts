import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { watch } from './helpers';

/** Records every canvas context type the page asks for. */
const recordContexts = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __ctx: string[] };
    w.__ctx = [];
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      w.__ctx.push(type);
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as never;
    } as typeof orig;
  });
const contexts = (page: Page) => page.evaluate(() => (window as unknown as { __ctx: string[] }).__ctx);
const isGl = (t: string) => /webgl/i.test(t);
const tier = (page: Page) => page.locator('#app').getAttribute('data-quality');

test('?quality=css never creates a WebGL context and draws the orb with CSS/SVG', async ({ page }) => {
  const wt = await watch(page);
  await recordContexts(page);
  await page.goto('/?quality=css');
  await page.waitForTimeout(2500);
  expect(await tier(page)).toBe('css');
  expect((await contexts(page)).filter(isGl)).toEqual([]);
  await expect(page.locator('#orbCss')).toBeVisible();
  await expect(page.locator('#gl')).toBeHidden();
  await expect(page.locator('#qTxt')).toHaveText('CSS');
  // the css orb follows the scene: it is moved and sized by the same state as the WebGL orb
  const idleBox = (await page.locator('#orbCss').boundingBox())!;
  await page.locator('#dock button[data-mode="research"]').click();
  await page.waitForTimeout(2200);
  const parkBox = (await page.locator('#orbCss').boundingBox())!;
  expect(parkBox.width).toBeLessThan(idleBox.width * 0.7);
  expect(wt.errors).toEqual([]);
});

test('?quality=css has no WebGL context in every scene', async ({ page }) => {
  await recordContexts(page);
  await page.goto('/?quality=css');
  for (const m of ['listen', 'think', 'research', 'locate', 'vision', 'briefing', 'focus', 'alert', 'success', 'sleep']) {
    await page.locator(`#dock button[data-mode="${m}"]`).click();
    await page.waitForTimeout(250);
  }
  expect((await contexts(page)).filter(isGl)).toEqual([]);
});

test('?quality=full creates WebGL, bloom on, rain and scanlines kept', async ({ page }) => {
  await recordContexts(page);
  await page.goto('/?quality=full');
  await page.waitForTimeout(1500);
  expect(await tier(page)).toBe('full');
  expect((await contexts(page)).filter(isGl).length).toBeGreaterThan(0);
  await expect(page.locator('#rain')).toBeVisible();
  await expect(page.locator('#orbCss')).toBeHidden();
});

test('?quality=lite: WebGL without bloom, no code rain, no scanlines', async ({ page }) => {
  await recordContexts(page);
  await page.goto('/?quality=lite');
  await page.locator('#dock button[data-mode="alert"]').click();
  await page.waitForTimeout(1500);
  expect(await tier(page)).toBe('lite');
  expect((await contexts(page)).filter(isGl).length).toBeGreaterThan(0);
  await expect(page.locator('#rain')).toBeHidden();
  expect(await page.locator('.scanlines').evaluate((e) => getComputedStyle(e).display)).toBe('none');
});

test('prefers-reduced-motion: css tier, no WebGL, no running CSS animation', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await recordContexts(page);
  await page.goto('/');
  await page.waitForTimeout(2000);
  expect(await tier(page)).toBe('css');
  expect((await contexts(page)).filter(isGl)).toEqual([]);
  for (const m of ['idle', 'research', 'alert', 'sleep']) {
    await page.locator(`#dock button[data-mode="${m}"]`).click();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length), m).toBe(0);
  }
  await ctx.close();
});

test('without WebGL support the page falls back to css by itself', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as never;
    } as typeof orig;
  });
  const wt = await watch(page);
  await page.goto('/');
  await page.waitForTimeout(1500);
  expect(await tier(page)).toBe('css');
  await expect(page.locator('#orbCss')).toBeVisible();
  expect(wt.errors).toEqual([]);
});

test('a slow display is lowered automatically: full -> lite -> css', async ({ page }) => {
  await page.addInitScript(() => {
    // ~10 fps animation frames
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 100) as unknown as number;
  });
  await page.goto('/');
  expect(await tier(page)).toBe('full');
  await expect.poll(() => tier(page), { timeout: 15_000, intervals: [250] }).toBe('lite');
  await expect.poll(() => tier(page), { timeout: 20_000, intervals: [250] }).toBe('css');
  await expect(page.locator('#orbCss')).toBeVisible();
  await expect(page.locator('#qBtn')).toHaveAttribute('aria-label', /set automatically/);
});

test('an explicit ?quality is never lowered automatically', async ({ page }) => {
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 100) as unknown as number;
  });
  await page.goto('/?quality=full');
  await page.waitForTimeout(11_000);
  expect(await tier(page)).toBe('full');
});

test('the header button changes the tier by hand and the choice is remembered', async ({ page }) => {
  await page.goto('/?quality=full');
  await expect(page.locator('#qTxt')).toHaveText('FULL');
  await page.locator('#qBtn').click(); // full -> lite (stored, ?quality dropped, page reloads)
  await expect(page.locator('#qTxt')).toHaveText('LITE');
  expect(await tier(page)).toBe('lite');
  expect(new URL(page.url()).searchParams.has('quality')).toBe(false);
  await page.reload();
  expect(await tier(page)).toBe('lite'); // remembered
  await page.locator('#qBtn').click(); // lite -> css
  await expect(page.locator('#qTxt')).toHaveText('CSS');
  await page.locator('#qBtn').click(); // css -> full
  await expect(page.locator('#qTxt')).toHaveText('FULL');
  expect(await page.evaluate(() => localStorage.getItem('vega.quality'))).toBe('full');
});

test('the page still works when localStorage throws', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
    });
  });
  const wt = await watch(page);
  await page.goto('/?quality=css');
  await page.waitForTimeout(1200);
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'idle');
  expect(wt.errors).toEqual([]);
});
