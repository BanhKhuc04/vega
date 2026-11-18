import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { SYSTEM_COMMAND, UI_SCENE, deviceTopic, parseScene } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import type { Sim } from '../../tools/sim/src/simlib';
import { loadConfig } from '../../brain/src/config';
import { startBrain } from '../../brain/src/service';
import type { Brain } from '../../brain/src/service';
import { T, watch } from './helpers';
import type { Watch } from './helpers';

/**
 * M1 end to end: broker (in process) + simulator + brain (in process, LLM provider `mock`) + dashboard in Chromium.
 * The owner types on the command bar; the brain answers on the screen and drives the virtual devices.
 */

let broker: Broker;
let sim: Sim;
let brain: Brain;
let spy: MqttClient;
const opened: BrowserContext[] = [];
const last = new Map<string, string>();
const scenes: SceneMessage[] = [];

test.beforeEach(async () => {
  last.clear();
  scenes.length = 0;
  broker = await startBroker({ port: 0, wsPort: 0 });
  const url = `mqtt://127.0.0.1:${broker.port}`;
  spy = mqtt.connect(url, { reconnectPeriod: 200 });
  await new Promise<void>((r) => spy.once('connect', () => r()));
  spy.on('message', (t, p) => {
    last.set(t, p.toString());
    if (t === UI_SCENE) {
      const r = parseScene(p.toString());
      if (r.ok) scenes.push(r.scene);
    }
  });
  await spy.subscribeAsync('vega/#');
  sim = await runSim({ url, intervalMs: 60_000, piIntervalMs: 60_000 }); // one reading each, so the expected values hold still
  brain = startBrain(loadConfig({ MQTT_URL: url, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:' }));
  await expect.poll(() => brain.registry.switches().length && brain.registry.sensors('co2').length, { timeout: 5000 }).toBe(2);
});

test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => {});
  await brain.stop().catch(() => {});
  await sim.stop().catch(() => {});
  spy.end(true);
  await broker.close().catch(() => {});
});

async function openPage(browser: Browser): Promise<{ page: Page; w: Watch }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  opened.push(ctx);
  const page = await ctx.newPage();
  const w = await watch(page);
  await page.goto(`/?quality=css&source=mqtt&mqtt=${encodeURIComponent(`ws://127.0.0.1:${broker.wsPort}`)}`);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  return { page, w };
}

async function say(page: Page, text: string): Promise<string> {
  const before = last.get(SYSTEM_COMMAND);
  await page.locator('#q').fill(text);
  await page.locator('#q').press('Enter');
  await expect.poll(() => last.get(SYSTEM_COMMAND) !== before && last.get(SYSTEM_COMMAND), { timeout: T(2000) }).toBeTruthy();
  return (JSON.parse(last.get(SYSTEM_COMMAND)!) as { id: string }).id;
}

const reading = (room: string, key: string) => JSON.parse(last.get(deviceTopic(room, 'env', 'state'))!)[key] as number;
const relayOn = (room: string, id: string) => (JSON.parse(last.get(deviceTopic(room, id, 'state')) ?? '{}') as { on?: boolean }).on;
const mode = (p: Page) => p.locator('#app').getAttribute('data-mode');

test('"phòng mấy độ, bật đèn giúp": the sim temperature on screen, the virtual relay on, 0 LLM calls in the ledger', async ({ browser }) => {
  const { page, w } = await openPage(browser);
  const temp = reading('bedroom', 'temp_c');
  expect(relayOn('livingroom', 'light')).toBe(false);
  const id = await say(page, 'phòng mấy độ, bật đèn giúp');
  await expect(page.locator('#caption')).toHaveText(`Bedroom ${temp.toFixed(1)}°C · Living room light on`, { timeout: T(4000) });
  await expect.poll(() => relayOn('livingroom', 'light'), { timeout: T(2000) }).toBe(true);
  expect(brain.store.llmCallsFor(id)).toBe(0);
  expect(brain.store.lastCommands(1)[0]).toMatchObject({ id, path: 'local', llmCalls: 0 });
  const thinkChips = scenes.filter((s) => s.scene === 'think').at(-1)!.data!.chips!.map((c) => c.label);
  expect(thinkChips).toEqual(['Parse intent', 'Local match', 'get_sensor temp bedroom', 'set_device livingroom/light']);
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

test('a sentence the local router does not know goes through the LLM (mock): right tool, Think chips match it', async ({ browser }) => {
  const { page, w } = await openPage(browser);
  const co2 = reading('balcony', 'co2_ppm');
  const id = await say(page, 'ngoài ban công không khí có trong lành không');
  await expect(page.locator('#caption')).toHaveText(`Balcony CO₂ ${Math.round(co2)} ppm`, { timeout: T(4000) });
  expect(brain.store.llmCallsFor(id)).toBe(2);
  const chips = scenes.filter((s) => s.scene === 'think').at(-1)!.data!.chips!;
  expect(chips.filter((c) => !c.label.startsWith('LLM ') && c.label !== 'Parse intent').map((c) => c.label)).toEqual(['get_sensor co2 balcony']);
  expect(w.errors).toEqual([]);
});

test('a high-risk device waits for "yes" on screen before it switches', async ({ browser }) => {
  const { page, w } = await openPage(browser);
  await say(page, 'bật ổ cắm');
  await expect.poll(() => mode(page), { timeout: T(2000) }).toBe('alert');
  await expect(page.locator('.alert-card .err')).toHaveText('Turn on Kitchen plug?');
  await page.waitForTimeout(500);
  expect(relayOn('kitchen', 'plug')).toBe(false);
  await say(page, 'yes');
  await expect.poll(() => relayOn('kitchen', 'plug'), { timeout: T(2000) }).toBe(true);
  await expect(page.locator('#caption')).toHaveText('Kitchen plug on', { timeout: T(4000) });
  expect(w.errors).toEqual([]);
});
