import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SCENE_NAMES, noHorizontalScroll, settle, shot, textOverlaps, watch } from './helpers';

/** Scenes are no longer on screen buttons (the brain picks them); `#hash` still switches them for development. */
const dockTo = async (page: Page, name: string) => {
  await page.evaluate((m) => (location.hash = `#${m}`), name);
  await expect(page.locator('#app')).toHaveAttribute('data-mode', name);
  await expect(page.locator(`.tpl[data-tpl="${name}"]`)).toHaveClass(/\bon\b/);
};

for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']] as const) {
  test(`SIM mode: all 11 scenes switch via #hash, no console errors, no external requests @${tag}`, async ({ page }) => {
    const wt = await watch(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/?quality=full');
    await expect(page).toHaveTitle('VEGA Core');
    await expect(page.locator('#conn')).toHaveAttribute('data-state', 'sim');
    await expect(page.locator('#connTxt')).toHaveText('SIM');
    await expect(page.locator('#sampleTag')).toBeVisible();
    await expect(page.locator('#sampleTag')).toHaveText('sample data');
    for (const name of SCENE_NAMES) {
      await dockTo(page, name);
      await settle(page);
      await noHorizontalScroll(page);
      await shot(page, `m0/${tag}-${name}`);
    }
    expect(wt.errors).toEqual([]);
    expect(wt.external).toEqual([]);
  });
}

test('390px: no text drawn over other text in any of the 11 scenes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?quality=css');
  const problems: Record<string, string[]> = {};
  for (const name of SCENE_NAMES) {
    await dockTo(page, name);
    await settle(page, 2600);
    const o = await textOverlaps(page);
    if (o.length) problems[name] = o;
  }
  expect(problems).toEqual({});
});

test('1440px: no text drawn over other text in any of the 11 scenes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?quality=css');
  const problems: Record<string, string[]> = {};
  for (const name of SCENE_NAMES) {
    await dockTo(page, name);
    await settle(page, 2600);
    const o = await textOverlaps(page);
    if (o.length) problems[name] = o;
  }
  expect(problems).toEqual({});
});

test('the demo controls are gone; #hash still switches scenes by hand', async ({ page }) => {
  await page.goto('/?quality=css#briefing');
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'briefing');
  await expect(page.locator('#dock, .lvl')).toHaveCount(0);
  await page.keyboard.press('4'); // number keys no longer switch scenes
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'briefing');
  await page.evaluate(() => (location.hash = '#sleep'));
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'sleep');
});

test('research: Expand opens the large chart and Collapse closes it', async ({ page }) => {
  await page.goto('/?quality=css#research');
  await settle(page, 2500);
  await page.locator('#expand').click();
  await expect(page.locator('#xLayer #co2')).toBeVisible();
  await page.locator('#collapse').click();
  await expect(page.locator('#xLayer #co2')).toHaveCount(0);
});

test('the chart shows the CO₂ sample correctly (threshold line, amber bars, peak)', async ({ page }) => {
  await page.goto('/?quality=css#research');
  await settle(page, 2500);
  const bars = page.locator('#bars i');
  await expect(bars).toHaveCount(24);
  const amber = await bars.evaluateAll((els) => els.map((e) => e.classList.contains('w')));
  expect(amber).toEqual([false, ...Array(7).fill(true), ...Array(16).fill(false)]);
  const plot = (await page.locator('.plot').boundingBox())!;
  const thr = (await page.locator('.plot .thr').boundingBox())!;
  expect((plot.y + plot.height - thr.y) / plot.height).toBeCloseTo(1000 / 1500, 1);
});

test('typing a command no longer routes the screen by itself: the brain decides (Brief 0004, B9)', async ({ page }) => {
  await page.goto('/?quality=css');
  await page.locator('#q').fill('research CO2 sensors');
  await page.locator('#q').press('Enter');
  // SIM mode has no brain: the command is not lost, the panel says it was not sent and it stays in the box
  await expect(page.locator('#chat .msg.sys span')).toHaveText([/^Not sent — not connected/]);
  await expect(page.locator('#q')).toHaveValue('research CO2 sensors');
  await page.waitForTimeout(2500); // the old demo went think -> research after 1.8 s
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'idle');
});

test('the room readings are visible even when the Idle intro is restarted right after loading', async ({ page }) => {
  await page.goto('/?quality=css');
  await page.waitForTimeout(400); // the first intro is half way
  await page.evaluate(() => (location.hash = '#think'));
  await page.evaluate(() => (location.hash = '#idle')); // a second Idle intro before the first one ended
  await page.waitForTimeout(2500);
  const ops = await page.locator('.side .ro').evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
  expect(ops.length).toBe(7); // room, CO₂, presence · mesh, CI, AI budget, up next
  expect(ops.every((o) => o > 0.99)).toBe(true);
});

test('accessibility basics', async ({ page }) => {
  await page.goto('/?quality=css');
  await expect(page.getByLabel('Ask VEGA')).toBeVisible();
  const names = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button')].filter((b) => !(b.textContent ?? '').trim() && !b.getAttribute('aria-label')).length,
  );
  expect(names).toBe(0);
  for (const sel of ['#qBtn', '#micBtn']) await expect(page.locator(sel)).toHaveAttribute('aria-label', /.+/);
  await expect(page.locator('#conn')).toHaveAttribute('role', 'status');
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => getComputedStyle(e).cursor === 'pointer' && !['BUTTON', 'A', 'INPUT', 'LABEL'].includes(e.tagName) && !e.closest('button, a'))
      .map((e) => `${e.tagName}.${e.className}`),
  );
  expect(bad).toEqual([]);
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});

test('no sound before the first interaction; sounds only after', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __ac: number }).__ac = 0;
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(...a: ConstructorParameters<typeof AudioContext>) {
        super(...a);
        (window as unknown as { __ac: number }).__ac++;
      }
    };
  });
  await page.goto('/?quality=css');
  await page.evaluate(() => (location.hash = '#alert'));
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'alert');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { __ac: number }).__ac)).toBe(0);
  await page.locator('#aSnooze').click(); // Dismiss on the alert card: the first interaction
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __ac: number }).__ac)).toBeGreaterThan(0);
});
