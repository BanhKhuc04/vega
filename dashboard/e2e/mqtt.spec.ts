/**
 * Real-broker test. Needs a local `mosquitto` binary (apt install mosquitto) and MQTT_E2E=1:
 *   MQTT_E2E=1 npx playwright test e2e/mqtt.spec.ts --trace off
 * Uses infra/mosquitto-dev/mosquitto.conf (WebSocket on 9001).
 */
import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';

const hasMosquitto = spawnSync('mosquitto', ['-h']).status !== null && !spawnSync('which', ['mosquitto']).status;
const CONF = fileURLToPath(new URL('../../infra/mosquitto-dev/mosquitto.conf', import.meta.url));
const APP = 'http://localhost:5174';

test.skip(!process.env.MQTT_E2E || !hasMosquitto, 'needs MQTT_E2E=1 and a mosquitto binary');
test.describe.configure({ mode: 'serial' });

let broker: ChildProcess | null = null;
async function startBroker() {
  broker = spawn('mosquitto', ['-c', CONF], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise<boolean>((r) => {
      const c = mqtt.connect('mqtt://localhost:1883', { reconnectPeriod: 0, connectTimeout: 500 });
      c.on('connect', () => { c.end(true); r(true); });
      c.on('error', () => { c.end(true); r(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('mosquitto did not start');
}
async function stopBroker() {
  const b = broker;
  broker = null;
  if (!b) return;
  await new Promise<void>((r) => { b.once('exit', () => r()); b.kill('SIGKILL'); });
}
const connectPub = () =>
  new Promise<mqtt.MqttClient>((res) => {
    const c = mqtt.connect('mqtt://localhost:1883', { reconnectPeriod: 500 });
    c.on('connect', () => res(c));
  });
const put = (c: mqtt.MqttClient, topic: string, payload: string | object) =>
  c.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain: true });

test.beforeAll(startBroker);
test.afterAll(stopBroker);

test('widgets update within 2 s, offline shows immediately, broker loss is survivable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pub = await connectPub();
  put(pub, 'vega/bedroom/sensor/meta', { v: 1, kind: 'esp8266', room_name: 'Phòng ngủ' });
  put(pub, 'vega/bedroom/sensor/availability', 'online');
  put(pub, 'vega/desk/core/availability', 'online');
  put(pub, 'vega/system/events', { v: 1, type: 'ci', repo: 'firmware-esp', failed: 1, ts: new Date().toISOString() });

  await page.goto(`${APP}/?lite=0`);
  await expect(page.getByRole('status')).not.toContainText('mất kết nối', { timeout: 5000 });
  await expect(page.getByTestId('mock-badge')).toHaveCount(0); // real data is not labelled as sample

  // 1) update arrives in < 2 s
  const t0 = Date.now();
  put(pub, 'vega/bedroom/sensor/state', { v: 1, ts: new Date().toISOString(), temp_c: 31.5, humidity: 55, co2_ppm: 1234 });
  await expect(page.locator('.stat.tl')).toContainText('31.5°C', { timeout: 2000 });
  await expect(page.locator('.stat.tl')).toContainText('CO₂ 1.234 ppm');
  const dt = Date.now() - t0;
  console.log(`widget updated ${dt} ms after publish`);
  expect(dt).toBeLessThan(2000);
  await expect(page.locator('.stat.tr')).toContainText('MQTT 2/2');

  // 2) device reports offline -> shown immediately
  put(pub, 'vega/bedroom/sensor/availability', 'offline');
  await expect(page.getByTestId('offline-list')).toContainText('bedroom/sensor', { timeout: 2000 });
  await expect(page.locator('.stat.tr')).toContainText('MQTT 1/2');

  // 3) garbage on the wire does not break anything
  put(pub, 'vega/bedroom/sensor/state', '{garbage');
  put(pub, 'vega/system/events', '\u0000');
  await expect(page.locator('.stat.tl')).toContainText('31.5°C');

  // 4) command goes out on vega/system/command
  const got = new Promise<string>((res) => {
    pub.subscribe('vega/system/command');
    pub.on('message', (t, p) => t === 'vega/system/command' && res(p.toString()));
  });
  await page.getByLabel('Ra lệnh cho VEGA').fill('tắt đèn');
  await page.getByLabel('Ra lệnh cho VEGA').press('Enter');
  expect(JSON.parse(await got)).toMatchObject({ v: 1, text: 'tắt đèn' });

  // 5) broker dies: UI says so, does not go blank
  pub.end(true);
  await stopBroker();
  await expect(page.getByRole('status')).toContainText('mất kết nối', { timeout: 6000 });
  await expect(page.getByTestId('view-research')).toBeVisible(); // command moved us to research
  await expect(page.locator('body')).not.toBeEmpty();
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Chờ', exact: true }).click();
  await expect(page.locator('.stat.tl')).toContainText('31.5°C'); // last known data stays visible

  // 6) broker returns: auto reconnect, fresh data flows again
  await startBroker();
  await expect(page.getByRole('status')).not.toContainText('mất kết nối', { timeout: 10_000 });
  const pub2 = await connectPub();
  put(pub2, 'vega/bedroom/sensor/state', { v: 1, ts: new Date().toISOString(), temp_c: 20.1, humidity: 40, co2_ppm: 500 });
  await expect(page.locator('.stat.tl')).toContainText('20.1°C', { timeout: 2000 });
  pub2.end(true);
  expect(errors).toEqual([]);
});
