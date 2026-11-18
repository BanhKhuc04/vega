import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { resolve } from 'node:path';
import { UI_SCENE, parseScene } from '@vega/contract';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import type { Sim } from '../../tools/sim/src/simlib';
import { buildPayload, parseArgs } from '../../tools/sim/src/scene';
import { SCENE_NAMES, T, noHorizontalScroll, settle, shot, textOverlaps, watch } from './helpers';
import type { Watch } from './helpers';

/**
 * Everything here runs against a broker started inside the test process (aedes + WebSocket), so it needs neither
 * Docker nor a Mosquitto binary. The dashboard connects over WebSocket exactly as it does on the Pi.
 */

let broker: Broker | null = null;
let sim: Sim | null = null;
let spy: MqttClient;
const opened: BrowserContext[] = [];

const mqttUrl = () => `ws://127.0.0.1:${broker!.wsPort}`;
const lastPayload = new Map<string, string>();

/** `simEvery`: telemetry period. Tests that publish exact values use a long one so the sim does not overwrite them. */
async function bringUp(opts: { sim?: boolean; port?: number; wsPort?: number; simEvery?: number } = {}) {
  broker = await startBroker({ port: opts.port ?? 0, wsPort: opts.wsPort ?? 0 });
  spy = mqtt.connect(`mqtt://127.0.0.1:${broker.port}`, { reconnectPeriod: 200 });
  await new Promise<void>((r) => spy.once('connect', () => r()));
  spy.on('message', (t, p) => lastPayload.set(t, p.toString()));
  if (opts.sim !== false) sim = await runSim({ url: `mqtt://127.0.0.1:${broker.port}`, intervalMs: opts.simEvery ?? 400, piIntervalMs: opts.simEvery ? opts.simEvery * 2 : 800 });
}

async function tearDown() {
  for (const c of opened.splice(0)) await c.close().catch(() => {});
  await sim?.stop().catch(() => {});
  sim = null;
  spy?.end(true);
  await broker?.close().catch(() => {});
  broker = null;
  lastPayload.clear();
}
test.afterEach(tearDown);

async function openPage(browser: Browser, opts: { width?: number; height?: number; quality?: string } = {}): Promise<{ page: Page; w: Watch; sockets: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 } });
  opened.push(ctx);
  const page = await ctx.newPage();
  const sockets: string[] = [];
  page.on('websocket', (ws) => sockets.push(ws.url()));
  const w = await watch(page);
  await page.goto(`/?quality=${opts.quality ?? 'css'}&source=mqtt&mqtt=${encodeURIComponent(mqttUrl())}`);
  return { page, w, sockets };
}

const mode = (p: Page) => p.locator('#app').getAttribute('data-mode');
const live = (p: Page, k: string) => p.locator(`[data-live="${k}"]`);
const pubState = (topic: string, o: object) => spy.publish(topic, JSON.stringify({ v: 1, ts: new Date().toISOString(), ...o }), { retain: true });

test('connects, shows LIVE, drops the sample tag once real data is in, and talks to nothing but the broker', async ({ browser }) => {
  await bringUp();
  const { page, w, sockets } = await openPage(browser);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await expect(page.locator('#conn')).toHaveAttribute('data-state', 'live');
  await expect(page.locator('#sampleTag')).toBeHidden({ timeout: 8000 }); // sim has published every group
  await expect(live(page, 'meshOn')).toHaveText('6');
  await expect(live(page, 'meshTotal')).toHaveText('6');
  await expect(live(page, 'meshKinds')).toHaveText('esp8266 ×5 · esp32-s3 ×1');
  await expect(live(page, 'roomName')).toHaveText('Bedroom');
  await expect(live(page, 'presence')).toHaveText(/Occupied|Away/);
  await expect(live(page, 'piText')).toHaveText(/^PI · \d+°C$/);
  await expect(live(page, 'latText')).toHaveText(/^LATENCY · \d+ MS$/);
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
  expect(new Set(sockets.map((u) => new URL(u).href))).toEqual(new Set([new URL(mqttUrl()).href]));
});

test('Idle values update within 2 s of a publish; a device going offline lowers the mesh at once', async ({ browser }) => {
  await bringUp({ simEvery: 60_000 });
  const { page } = await openPage(browser);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await expect(live(page, 'meshOn')).toHaveText('6', { timeout: 6000 });
  await page.waitForTimeout(T(2000)); // the intro count-up must be over before exact values are asserted

  const t0 = Date.now();
  pubState('vega/bedroom/env/state', { temp_c: 31.5, humidity: 55, co2_ppm: 1234 });
  await expect(live(page, 'temp')).toHaveText('31.5', { timeout: T(2000) });
  await expect(live(page, 'co2')).toHaveText('1,234', { timeout: T(2000) });
  await expect(live(page, 'hum')).toHaveText('55', { timeout: T(2000) });
  const dt = Date.now() - t0;
  console.log(`room readings on screen ${dt} ms after publish`);
  expect(dt).toBeLessThan(T(2000));
  await expect(live(page, 'co2row')).toHaveClass(/warn/);
  pubState('vega/bedroom/env/state', { co2_ppm: 640 });
  await expect(live(page, 'co2')).toHaveText('640', { timeout: T(2000) });
  await expect(live(page, 'co2row')).not.toHaveClass(/warn/);
  await expect(live(page, 'temp')).toHaveText('31.5'); // partial states merge

  // system stats: header + callouts
  spy.publish('vega/system/pi', JSON.stringify({ v: 1, cpu_pct: 40, temp_c: 61 }), { retain: true });
  spy.publish('vega/system/net', JSON.stringify({ v: 1, latency_ms: 77 }), { retain: true });
  await expect(live(page, 'piText')).toHaveText('PI · 61°C', { timeout: T(2000) });
  await expect(live(page, 'coText')).toHaveText('CORE TEMP · 61°C', { timeout: T(2000) });
  await expect(live(page, 'latText')).toHaveText('LATENCY · 77 MS', { timeout: T(2000) });

  // a device dies: its Last Will says offline and the mesh drops within 2 s
  const t1 = Date.now();
  await sim!.killDevice('balcony/env');
  await expect(live(page, 'meshOn')).toHaveText('5', { timeout: T(2000) });
  await expect(live(page, 'meshText')).toHaveText('MESH · 5/6 ONLINE', { timeout: T(2000) });
  console.log(`mesh dropped ${Date.now() - t1} ms after the device died`);
  await sim!.reviveDevice('balcony/env');
  await expect(live(page, 'meshOn')).toHaveText('6', { timeout: 3000 });

  // CI and next event
  spy.publish('vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 'vega-brain', failed: 2, ts: new Date().toISOString() }), { retain: true });
  await expect(live(page, 'ci')).toHaveText('2 failed builds', { timeout: T(2000) });
  await expect(live(page, 'ciSub')).toContainText('vega-brain');
  await expect(live(page, 'cirow')).toHaveClass(/bad/);
});

test('a scene sent over MQTT changes every open tab within 1 s, uses the file data, and returns to idle after its ttl', async ({ browser }) => {
  await bringUp({ sim: false });
  const a = await openPage(browser);
  const b = await openPage(browser);
  await expect(a.page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await expect(b.page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await a.page.waitForTimeout(2000); // let the boot animation finish

  // resolve from the repository root, not from the cwd (CI runs this from dashboard/)
  const file = resolve(import.meta.dirname, '../../tools/sim/examples/research.json');
  const payload = buildPayload(parseArgs(['research', file, '--ttl', '5'], {}));
  const t0 = Date.now();
  spy.publish(UI_SCENE, payload, { retain: true });
  for (const { page } of [a, b]) {
    await expect.poll(() => mode(page), { timeout: T(1000), intervals: [25] }).toBe('research');
    await expect(page.locator('#rtitle')).toHaveText('Research: standing desk height for a 178 cm user', { timeout: T(1500) });
  }
  console.log(`both tabs switched ${Date.now() - t0} ms after the publish`);
  await expect(a.page.locator('#status')).toHaveText(/Researching/);
  await expect(a.page.locator('[data-tpl=research] .rstep')).toHaveText('step 4/5 · comparing sources');
  await expect(a.page.locator('.cmp tbody tr').first().locator('td').first()).toHaveText('Height range');
  expect(await a.page.locator('#bars i').count()).toBe(24);

  // ttl: back to idle in both
  await expect.poll(() => mode(a.page), { timeout: 8000, intervals: [100] }).toBe('idle');
  await expect.poll(() => mode(b.page), { timeout: 3000, intervals: [100] }).toBe('idle');
});

test('a tab opened later gets the retained scene; one that already expired is not shown', async ({ browser }) => {
  await bringUp({ sim: false });
  const payload = JSON.stringify({ v: 1, scene: 'focus', ts: new Date().toISOString(), data: { kicker: 'Deep work · late joiner', minutes: 5 } });
  spy.publish(UI_SCENE, payload, { retain: true });
  await new Promise((r) => setTimeout(r, 100));
  const late = await openPage(browser);
  await expect.poll(() => mode(late.page), { timeout: 4000, intervals: [100] }).toBe('focus');
  await expect(late.page.locator('[data-tpl=focus] > .k')).toHaveText('Deep work · late joiner');

  const stale = JSON.stringify({ v: 1, scene: 'alert', ttl: 30, ts: new Date(Date.now() - 120_000).toISOString() });
  spy.publish(UI_SCENE, stale, { retain: true });
  await new Promise((r) => setTimeout(r, 100));
  const second = await openPage(browser);
  await expect(second.page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await second.page.waitForTimeout(1500);
  expect(await mode(second.page)).toBe('idle');
});

test('wrong scenes are ignored: no crash, no change, a single console warning', async ({ browser }) => {
  await bringUp({ sim: false });
  const { page, w } = await openPage(browser);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await page.waitForTimeout(1500);
  spy.publish(UI_SCENE, JSON.stringify({ v: 1, scene: 'research' }), { retain: true });
  await expect.poll(() => mode(page), { timeout: T(1500) }).toBe('research');
  const bad = ['{this is not json', JSON.stringify({ v: 1, scene: 'disco' }), JSON.stringify({ v: 1, scene: 'alert', data: { error: 42 } }), JSON.stringify({ scene: 'alert' }), '\u0000\u0001\u0002'];
  for (const p of bad) spy.publish(UI_SCENE, p, { retain: true });
  await page.waitForTimeout(800);
  expect(await mode(page)).toBe('research'); // unchanged
  await expect(page.locator('#rtitle')).toBeVisible();
  const warns = w.warnings.filter((m) => m.includes('ignored invalid scene'));
  expect(warns).toHaveLength(1);
  expect(w.errors).toEqual([]);
  // and it still accepts a good one afterwards
  spy.publish(UI_SCENE, JSON.stringify({ v: 1, scene: 'success' }), { retain: true });
  await expect.poll(() => mode(page), { timeout: T(1500) }).toBe('success');
});

test('a CI failure event makes the sim raise the alert scene on every tab', async ({ browser }) => {
  await bringUp();
  const a = await openPage(browser);
  const b = await openPage(browser);
  await expect(a.page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await expect(b.page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await a.page.waitForTimeout(1800);
  expect(await mode(a.page)).toBe('idle');
  spy.publish('vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 'firmware-esp', failed: 1, ts: new Date().toISOString() }), { retain: true });
  for (const { page } of [a, b]) {
    await expect.poll(() => mode(page), { timeout: T(2000), intervals: [50] }).toBe('alert');
    await expect(page.locator('.alert-card .err')).toContainText('firmware-esp');
  }
  spy.publish('vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 'firmware-esp', failed: 0, ts: new Date().toISOString() }), { retain: true });
  await expect.poll(() => mode(a.page), { timeout: T(2000), intervals: [50] }).toBe('success');
});

for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']] as const) {
  test(`all 11 scenes arrive over MQTT and render their data (no layout breakage) @${tag}`, async ({ browser }) => {
    await bringUp({ sim: false });
    const { page, w: wt } = await openPage(browser, { width: w, height: h, quality: 'css' }); // the 1 s switch is an app criterion; software WebGL on a GPU-less runner cannot hold it at `full` (that tier is covered by the SIM test)
    await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
    await page.waitForTimeout(1800);
    const problems: Record<string, string[]> = {};
    for (const name of SCENE_NAMES) {
      const payload = buildPayload(parseArgs([name, '--ttl', '120'], {}));
      spy.publish(UI_SCENE, payload, { retain: true });
      await expect.poll(() => mode(page), { timeout: T(1000), intervals: [25] }).toBe(name);
      await settle(page, 2600);
      await noHorizontalScroll(page);
      const o = await textOverlaps(page);
      if (o.length) problems[name] = o;
      await shot(page, `m0/mqtt-${tag}-${name}`);
      const parsed = parseScene(payload);
      expect(parsed.ok).toBe(true);
    }
    expect(problems).toEqual({});
    expect(wt.errors).toEqual([]);
    expect(wt.external).toEqual([]);
  });
}

test('each scene shows text taken from its data', async ({ browser }) => {
  await bringUp({ sim: false });
  const { page } = await openPage(browser);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  const send = async (name: string) => {
    spy.publish(UI_SCENE, buildPayload(parseArgs([name, '--ttl', '120'], {})), { retain: true });
    await expect.poll(() => mode(page), { timeout: T(1000), intervals: [25] }).toBe(name);
  };
  await send('listen');
  await expect(page.locator('#transcript')).toContainText('temperature in the bedroom', { timeout: 6000 });
  await send('think');
  await expect(page.locator('#plan')).toContainText('room.read(bedroom)', { timeout: 6000 });
  await expect(page.locator('#chips .chip').nth(1)).toHaveText('Query room sensors');
  await send('locate');
  await expect(page.locator('[data-tpl=locate] .rhead h1')).toHaveText('Locate: nearest pharmacy');
  await expect(page.locator('.turns li')).toHaveCount(3);
  await send('vision');
  await expect(page.locator('.vhud.tl')).toContainText('CAM-01 · DESK');
  await send('briefing');
  await expect(page.locator('.greet .k')).toHaveText('Thu · 19 Nov · morning briefing');
  await expect(page.locator('[data-p=b1] .agenda li')).toHaveCount(2);
  await send('focus');
  await expect(page.locator('#timer')).toHaveText(/^(50:00|49:5\d)$/, { timeout: 6000 });
  await send('alert');
  await expect(page.locator('.alert-card .err')).toContainText('TS2345');
  await send('success');
  await expect(page.locator('.checks li')).toHaveCount(3);
  await send('sleep');
  await expect(page.locator('[data-tpl=sleep] .hint')).toContainText('alarm 06:45');
  await send('idle');
  await expect(page.locator('#caption')).toHaveText(/Standing by · all quiet/, { timeout: 6000 });
});

test('losing the broker: header RECONNECTING, last scene and data stay, nothing goes blank; LIVE again by itself', async ({ browser }) => {
  await bringUp({ simEvery: 60_000 });
  const { page, w } = await openPage(browser);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await page.waitForTimeout(T(2000)); // the intro count-up must be over before exact values are asserted
  pubState('vega/bedroom/env/state', { temp_c: 30.2, humidity: 61, co2_ppm: 1500 });
  await expect(live(page, 'co2')).toHaveText('1,500', { timeout: T(2000) });
  spy.publish(UI_SCENE, JSON.stringify({ v: 1, scene: 'research', data: { title: 'Research: before the outage' } }), { retain: true });
  await expect.poll(() => mode(page), { timeout: T(1500) }).toBe('research');
  await page.waitForTimeout(1500);

  const { port, wsPort } = broker!;
  await sim!.stop();
  sim = null;
  spy.end(true);
  await broker!.close();
  broker = null;

  await expect(page.locator('#connTxt')).toHaveText('RECONNECTING', { timeout: 6000 });
  await expect(page.locator('#conn')).toHaveAttribute('data-state', 'reconnecting');
  expect(await mode(page)).toBe('research'); // last scene kept
  await expect(page.locator('#rtitle')).toHaveText('Research: before the outage');
  expect((await page.locator('body').innerText()).length).toBeGreaterThan(100); // not blank
  await page.locator('#dock button[data-mode="idle"]').click();
  await expect(live(page, 'co2')).toHaveText('1,500'); // last known readings still shown
  await page.screenshot({ path: shoot() ? `${process.cwd()}/../docs/screenshots/m0/reconnecting.png` : '/dev/null' }).catch(() => {});

  await bringUp({ sim: false, port, wsPort });
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 15_000 });
  pubState('vega/bedroom/env/state', { co2_ppm: 777 });
  await expect(live(page, 'co2')).toHaveText('777', { timeout: T(2000) });
  // While the broker is down Chromium itself logs each refused reconnect; that is the browser's report of the outage
  // we caused on purpose, not an app error. Anything else still fails the test.
  expect(w.errors.filter((e) => !/WebSocket connection to .* failed/.test(e))).toEqual([]);
});

function shoot() {
  return process.env.SHOTS === '1';
}

test('no broker at all: OFFLINE with sample data, nothing breaks', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  opened.push(ctx);
  const page = await ctx.newPage();
  const w = await watch(page);
  await page.goto(`/?quality=css&source=mqtt&mqtt=${encodeURIComponent('ws://127.0.0.1:1')}`);
  await expect(page.locator('#connTxt')).toHaveText('OFFLINE', { timeout: 8000 });
  await expect(page.locator('#sampleTag')).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'idle');
  expect(w.errors.filter((e) => !/WebSocket|ERR_CONNECTION/i.test(e))).toEqual([]);
});

test('the command bar publishes vega/system/command while connected', async ({ browser }) => {
  await bringUp({ sim: false });
  const { page } = await openPage(browser);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  await spy.subscribeAsync('vega/system/command');
  await page.locator('#q').fill('turn off the main light');
  await page.locator('#q').press('Enter');
  await expect.poll(() => lastPayload.get('vega/system/command') ?? '', { timeout: T(2000) }).not.toBe('');
  expect(JSON.parse(lastPayload.get('vega/system/command')!)).toMatchObject({ v: 1, text: 'turn off the main light' });
});
