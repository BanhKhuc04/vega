import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHOT_DIR = fileURLToPath(new URL('../../docs/screenshots', import.meta.url));
const shoot = process.env.SHOTS === '1';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  return errors;
}

const NAV = ['Chờ', 'Nghiên cứu', 'Tập trung', 'Lịch sử'] as const;
const VIEW: Record<(typeof NAV)[number], string> = { 'Chờ': 'idle', 'Nghiên cứu': 'research', 'Tập trung': 'focus', 'Lịch sử': 'history' };

async function snap(page: Page, name: string, fullPage = true) {
  if (!shoot) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.waitForTimeout(1600); // let enter animations settle
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage });
}

async function noHorizontalScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'document must not scroll horizontally').toBeLessThanOrEqual(iw);
}

for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']] as const) {
  test(`all four screens load and switch with no console errors @${tag}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/?lite=0');
    await expect(page).toHaveTitle('VEGA');
    await expect(page.getByTestId('view-idle')).toBeVisible();
    await expect(page.getByTestId('mock-badge')).toHaveText('dữ liệu mẫu');
    await snap(page, `${tag}-idle`);
    for (const label of NAV) {
      await page.getByRole('navigation', { name: 'Chế độ hiển thị' }).getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByTestId(`view-${VIEW[label]}`)).toBeVisible();
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await noHorizontalScroll(page);
      await snap(page, `${tag}-${VIEW[label]}`);
    }
    await page.getByRole('link', { name: 'Lõi tròn' }).click();
    await expect(page.getByTestId('view-core')).toBeVisible();
    await noHorizontalScroll(page);
    await snap(page, `${tag}-core`);
    expect(errors).toEqual([]);
  });
}

test('expand, close and command flow', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?lite=0#/research');
  await page.getByRole('button', { name: 'Mở rộng ⤢' }).click();
  await expect(page.getByTestId('view-focus')).toBeVisible();
  await page.getByRole('button', { name: 'Đóng chế độ tập trung' }).click();
  await expect(page.getByTestId('view-research')).toBeVisible();

  await page.getByRole('button', { name: 'Chờ', exact: true }).click();
  await page.getByLabel('Ra lệnh cho VEGA').fill('đo độ ẩm phòng bếp');
  await page.getByLabel('Ra lệnh cho VEGA').press('Enter');
  await expect(page.getByTestId('view-research')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nghiên cứu: đo độ ẩm phòng bếp');
  await expect(page.getByLabel('Ra lệnh cho VEGA')).toHaveValue('');

  // the "Gửi" button works too
  await page.getByLabel('Ra lệnh cho VEGA').fill('lệnh hai');
  await page.getByRole('button', { name: 'Gửi' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nghiên cứu: lệnh hai');

  await page.getByRole('button', { name: 'Lịch sử', exact: true }).click();
  const items = page.getByTestId('history-item');
  await expect(items).toHaveCount(5);
  await expect(items.first()).toContainText('lệnh hai');
  await items.nth(1).click(); // "đo độ ẩm phòng bếp"
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nghiên cứu: đo độ ẩm phòng bếp');
  // an older sample entry reopens its own research screen
  await page.getByRole('button', { name: 'Lịch sử', exact: true }).click();
  await items.last().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('tắt đèn phòng khách');
  expect(errors).toEqual([]);
});

test('empty command does nothing', async ({ page }) => {
  await page.goto('/?lite=0');
  await page.getByLabel('Ra lệnh cho VEGA').press('Enter');
  await expect(page.getByTestId('view-idle')).toBeVisible();
});

test('CO₂ chart matches the design data', async ({ page }) => {
  await page.goto('/?lite=0#/focus');
  const chart = page.getByTestId('co2-chart-lg');
  const bars = chart.getByTestId('co2-bar');
  await expect(bars).toHaveCount(24);
  const box = (await chart.boundingBox())!;
  const thr = (await chart.getByTestId('co2-threshold').boundingBox())!;
  // threshold line sits at 1000/1500 of the chart height, measured from the bottom
  const fromBottom = (box.y + box.height - thr.y) / box.height;
  expect(fromBottom).toBeCloseTo(1000 / 1500, 1);
  const data = await bars.evaluateAll((els) =>
    els.map((e) => ({ hour: Number(e.getAttribute('data-hour')), ppm: Number(e.getAttribute('data-ppm')), over: e.getAttribute('data-over'), bg: getComputedStyle(e).backgroundColor })),
  );
  const peak = data.reduce((a, b) => (b.ppm > a.ppm ? b : a));
  expect(peak).toMatchObject({ hour: 5, ppm: 1420 });
  for (const d of data) {
    expect(d.over === 'true', `hour ${d.hour}`).toBe(d.ppm > 1000);
    expect(d.bg, `hour ${d.hour}`).toBe(d.ppm > 1000 ? 'rgb(255, 194, 102)' : 'rgb(242, 248, 255)');
  }
  await expect(page.getByTestId('focus-peak')).toContainText('1.420 ppm lúc 05:00');
});

test('390px: stat blocks form a 2x2 grid above the orb without overlapping', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lite=0');
  const rects = await page.locator('.stat').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  expect(rects).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = rects[i], b = rects[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `stat ${i} vs ${j}`).toBe(false);
    }
  }
  expect(Math.abs(rects[0].top - rects[1].top)).toBeLessThan(2); // same row
  expect(Math.abs(rects[2].top - rects[3].top)).toBeLessThan(2);
  expect(rects[2].top).toBeGreaterThan(rects[0].bottom - 1); // second row below the first
  const orb = (await page.getByTestId('main-orb').boundingBox())!;
  expect(orb.y).toBeGreaterThanOrEqual(rects[3].top + rects[3].height - 1); // orb is below the grid
  // no text clipped inside the blocks
  const clipped = await page.locator('.stat').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(clipped).toBe(0);
});

test('390px: every enabled button and link can be clicked in every screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?lite=0');
  for (const view of ['idle', 'research', 'focus', 'history', 'core']) {
    await page.goto(`/?lite=0#/${view}`);
    await page.waitForTimeout(900);
    const targets = page.locator('button:enabled, a[href], input');
    const n = await targets.count();
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < n; i++) await targets.nth(i).click({ trial: true });
    await noHorizontalScroll(page);
  }
});

test('Lite mode via ?lite=1 and via the switch', async ({ page }) => {
  await page.goto('/?lite=0');
  await expect(page.locator('html')).not.toHaveAttribute('data-lite');
  expect(await page.getByTestId('particle').count()).toBe(18);
  const ringFilter = () => page.locator('.orb .spin-a').first().evaluate((e) => getComputedStyle(e).filter);
  expect(await ringFilter()).toContain('drop-shadow');

  await page.goto('/?lite=1');
  await expect(page.locator('html')).toHaveAttribute('data-lite', '');
  expect(await page.getByTestId('particle').count()).toBe(0);
  expect(await ringFilter()).toBe('none');
  // only 2 rotating rings left in the orb
  expect(await page.locator('.orb [class*="spin-"]').count()).toBe(2);
  // no blur / drop-shadow filter anywhere
  await page.getByRole('button', { name: 'Nghiên cứu', exact: true }).click();
  await page.getByRole('button', { name: 'Mở rộng ⤢' }).click();
  const filtered = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).filter !== 'none').length);
  expect(filtered).toBe(0);

  // manual switch
  await page.goto('/?lite=0');
  const sw = page.getByRole('button', { name: /^Lite/ });
  await expect(sw).toHaveAttribute('aria-pressed', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-lite', '');
  await sw.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-lite');
});

test('prefers-reduced-motion stops every animation and enables Lite', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-lite', '');
  for (const view of ['idle', 'research', 'focus', 'core']) {
    await page.goto(`/#/${view}`);
    await page.waitForTimeout(500);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    expect(running, view).toBe(0);
  }
  await ctx.close();
});

test('Lite turns itself on when FPS is low (simulated)', async ({ page }) => {
  await page.addInitScript(() => {
    // Slow rAF: ~10 fps
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => setTimeout(() => cb(performance.now()), 100) as unknown as number) as number;
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-lite', '', { timeout: 8000 });
});

test('#/core shows all six core states and lets you pick one', async ({ page }) => {
  await page.goto('/#/core');
  const screens = page.getByTestId('core-screen');
  await expect(screens).toHaveCount(7); // 1 big preview + 6 gallery
  const states = await screens.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
  expect(new Set(states.slice(1))).toEqual(new Set(['idle', 'listening', 'thinking', 'speaking', 'alert', 'sleep']));
  const big = screens.first();
  const size = await big.boundingBox();
  expect([size!.width, size!.height]).toEqual([240, 240]);
  for (const [label, state] of [['Đang nghe', 'listening'], ['Đang nghĩ', 'thinking'], ['Đang nói', 'speaking'], ['Cảnh báo', 'alert'], ['Ngủ', 'sleep'], ['Chờ', 'idle']] as const) {
    await page.getByRole('group', { name: 'Chọn trạng thái lõi' }).getByRole('button', { name: label, exact: true }).click();
    await expect(big).toHaveAttribute('data-state', state);
  }
});

test('accessibility basics', async ({ page }) => {
  for (const view of ['idle', 'research', 'focus', 'history', 'core']) {
    await page.goto(`/?lite=0#/${view}`);
    // anything that looks clickable is a real button / link / input / label
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((e) => getComputedStyle(e).cursor === 'pointer' && !['BUTTON', 'A', 'INPUT', 'LABEL'].includes(e.tagName) && !e.closest('button, a'))
        .map((e) => e.tagName + '.' + e.className),
    );
    expect(bad, view).toEqual([]);
    // icon-only / glyph-only buttons are named
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button')].filter((b) => !(b.textContent ?? '').replace(/[×⤢]/g, '').trim() && !b.getAttribute('aria-label')).length,
    );
    expect(unnamed, view).toBe(0);
    // no <img>/<svg role=img> without a name, no empty links
    const svgUnlabeled = await page.evaluate(() => [...document.querySelectorAll('svg')].filter((s) => s.getAttribute('aria-hidden') !== 'true' && !s.getAttribute('aria-label')).length);
    expect(svgUnlabeled, view).toBe(0);
  }
  await page.goto('/?lite=0');
  await expect(page.getByLabel('Ra lệnh cho VEGA')).toBeVisible();
  const mic = page.getByRole('button', { name: /Nói bằng giọng/ });
  await expect(mic).toBeDisabled();
  await expect(mic).toHaveAttribute('aria-label', /Phase 6/);
  // visible focus ring on keyboard focus
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  // buttons meet a 44px touch target
  const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height < 44).length);
  expect(small).toBe(0);
});

test('tables have header scope for assistive tech', async ({ page }) => {
  await page.goto('/#/research');
  await expect(page.locator('th[scope="col"]')).toHaveCount(3);
  const wrap = page.getByTestId('compare-wrap');
  await expect(wrap).toHaveCSS('overflow-x', 'auto');
});
