import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { SYSTEM_COMMAND, SYSTEM_PRESENCE, deviceTopic } from '@vega/contract';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import type { Sim } from '../../tools/sim/src/simlib';
import { loadConfig } from '../../brain/src/config';
import { startBrain } from '../../brain/src/service';
import type { Brain } from '../../brain/src/service';
import { T, noHorizontalScroll, watch } from './helpers';

/**
 * M8 end to end (brief 0013): the Console against a real brain (its /api forwarded like nginx does, with the token), and
 * the phone (simulated OwnTracks) on the Locate screen and in the AWAY chip.
 */
const TOKEN = 'e2e-console-token-0123456789';
const HOME = { lat: 21.0285, lon: 105.8542 };
// a 1×1 PNG for the OpenStreetMap tiles: CI must not depend on (or load) a third-party tile server
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let broker: Broker;
let sim: Sim;
let brain: Brain;
let spy: MqttClient;
let port: number;
const last = new Map<string, string>();
const opened: BrowserContext[] = [];

test.beforeEach(async () => {
  last.clear();
  broker = await startBroker({ port: 0, wsPort: 0 });
  const url = `mqtt://127.0.0.1:${broker.port}`;
  spy = mqtt.connect(url, { reconnectPeriod: 200 });
  await new Promise<void>((r) => spy.once('connect', () => r()));
  spy.on('message', (t, p) => last.set(t, p.toString()));
  await spy.subscribeAsync('vega/#');
  // the phone walks: 4 fixes at home, then away, one fix every 400 ms
  sim = await runSim({ url, intervalMs: 60_000, piIntervalMs: 60_000, initialCi: 'none', sceneRule: false, phone: HOME, phoneIntervalMs: 400 });
  brain = startBrain(loadConfig({ MQTT_URL: url, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:', VOICE_PORT: '0', CONSOLE_TOKEN: TOKEN, HOME_LAT: String(HOME.lat), HOME_LON: String(HOME.lon) }));
  port = (await brain.voicePort)!;
  await expect.poll(() => brain.registry.switches().length, { timeout: 5000 }).toBe(2);
});

test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => {});
  await brain.stop().catch(() => {});
  await sim.stop().catch(() => {});
  spy.end(true);
  await broker.close().catch(() => {});
});

async function context(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  opened.push(ctx);
  return ctx.newPage();
}

/** /api as nginx serves it: forwarded to the brain under test, which checks the token from /config.js. */
async function forwardApi(page: Page): Promise<void> {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: `window.__VEGA__ = { consoleToken: "${TOKEN}" };` }));
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` }) });
  });
}

test('M8 Console: Today, devices (switch one), reminders (cancel one), commands, costs, access; no sideways scroll at 390 px', async ({ browser }) => {
  const page = await context(browser);
  const w = await watch(page);
  await forwardApi(page);
  const r = brain.store.addReminder(Date.now() + 3_600_000, 'gọi mẹ', Date.now());

  await page.goto('/console.html');
  await expect(page.locator('.card').filter({ hasText: 'Devices' }).locator('b')).toHaveText('6/6', { timeout: T(4000) });
  await expect(page.locator('.card').filter({ hasText: 'Reminders' }).locator('b')).toHaveText('1');

  await page.locator('#tabs a', { hasText: 'Devices' }).click();
  const light = page.locator('tr', { hasText: 'đèn' });
  await light.getByRole('button', { name: 'Turn on' }).click();
  // the Console's action is an ordinary command: the virtual relay switches
  await expect.poll(() => last.get(deviceTopic('livingroom', 'light', 'state')) ?? '', { timeout: T(3000) }).toContain('"on":true');
  await expect(light.getByRole('button', { name: 'Turn off' })).toBeVisible();

  await page.locator('#tabs a', { hasText: 'Reminders' }).click();
  await page.locator('tr', { hasText: 'gọi mẹ' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#msg')).toHaveText(`Đã huỷ lời nhắc #${r.id}.`, { timeout: T(3000) });
  expect(brain.store.pendingReminders()).toEqual([]);

  await page.locator('#tabs a', { hasText: 'Commands' }).click();
  await expect(page.locator('tbody tr').first()).toContainText(`huỷ nhắc ${r.id}`);
  await page.locator('#tabs a', { hasText: 'Costs' }).click();
  await expect(page.locator('main')).toContainText('No AI spending');
  await page.locator('#tabs a', { hasText: 'Access' }).click();
  await expect(page.locator('main')).toContainText('Phone location');

  await page.setViewportSize({ width: 390, height: 800 });
  for (const tab of ['today', 'devices', 'commands', 'access']) {
    await page.goto(`/console.html#${tab}`);
    await expect(page.locator('main > *').first()).toBeVisible();
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(sw, `#${tab} scrolls sideways`).toBeLessThanOrEqual(iw);
  }
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

test('M8 Console: a wrong token shows how to fix it', async ({ browser }) => {
  const page = await context(browser);
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.__VEGA__ = { consoleToken: "wrong-token-wrong-token-00" };' }));
  await page.route('**/api/**', async (route) => route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${port}${new URL(route.request().url()).pathname}` }) }));
  await page.goto('/console.html');
  await expect(page.locator('#msg')).toContainText('token is wrong', { timeout: T(4000) });
});

test('M8 Locate: "tôi đang ở đâu" shows the phone on an OpenStreetMap map; walking away turns on AWAY', async ({ browser }) => {
  const page = await context(browser, { width: 1440, height: 900 });
  const w = await watch(page);
  const tiles: string[] = [];
  await page.route('https://tile.openstreetmap.org/**', (r) => {
    tiles.push(r.request().url());
    return r.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.goto(`/?quality=css&source=mqtt&mqtt=${encodeURIComponent(`ws://127.0.0.1:${broker.wsPort}`)}`);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });

  await expect.poll(() => brain.locator.latest !== null, { timeout: T(3000) }).toBe(true);
  const before = last.get(SYSTEM_COMMAND);
  await page.locator('#q').fill('tôi đang ở đâu');
  await page.locator('#q').press('Enter');
  await expect.poll(() => last.get(SYSTEM_COMMAND) !== before, { timeout: T(2000) }).toBe(true);
  await expect(page.locator('[data-tpl=locate] #map .osm')).toBeVisible({ timeout: T(4000) });
  await expect(page.locator('[data-tpl=locate] #map a', { hasText: 'Open in Maps' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('[data-p=nmea]')).toBeHidden();
  expect(tiles.length).toBeGreaterThanOrEqual(15);

  // the walk leaves the home circle after four fixes
  await expect.poll(() => last.get(SYSTEM_PRESENCE) ?? '', { timeout: T(5000) }).toContain('"away"');
  await expect(page.locator('#awayChip')).toBeVisible();
  await noHorizontalScroll(page);
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});
