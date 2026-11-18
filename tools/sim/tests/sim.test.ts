import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { SCENES, UI_SCENE, deviceTopic, parseMessage, parseScene } from '@vega/contract';
import { startBroker } from '../src/broker';
import type { Broker } from '../src/broker';
import { CO2_BY_HOUR, co2At, envAt, humidityAt, presenceAt, tempAt } from '../src/model';
import { DEVICES, runSim } from '../src/simlib';
import type { Sim } from '../src/simlib';
import { buildPayload, parseArgs } from '../src/scene';

describe('model', () => {
  it('CO₂ follows the design curve: peak 1420 at 05:00, interpolates between hours, wraps', () => {
    expect(co2At(5)).toBe(1420);
    expect(Math.max(...CO2_BY_HOUR)).toBe(1420);
    expect(co2At(5.5)).toBeCloseTo((1420 + 1360) / 2, 5);
    expect(co2At(24)).toBe(co2At(0));
    expect(co2At(-1)).toBe(CO2_BY_HOUR[23]);
  });
  it('night is stuffy, afternoon is fresh', () => {
    expect(co2At(4)).toBeGreaterThan(1000);
    expect(co2At(11)).toBeLessThan(700);
  });
  it('temperature and humidity stay plausible all day', () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(tempAt(h)).toBeGreaterThan(23);
      expect(tempAt(h)).toBeLessThan(30);
      expect(humidityAt(h)).toBeGreaterThan(55);
      expect(humidityAt(h)).toBeLessThan(75);
    }
  });
  it('someone is at the desk by day, not at 03:00', () => {
    expect(presenceAt(14)).toBe(true);
    expect(presenceAt(3)).toBe(false);
  });
  it('envAt adds bounded noise', () => {
    const d = new Date(2026, 10, 18, 5, 0, 0);
    const lo = envAt(d, () => 0);
    const hi = envAt(d, () => 0.999999);
    expect(lo.co2_ppm).toBeLessThan(hi.co2_ppm);
    expect(hi.co2_ppm - lo.co2_ppm).toBeLessThanOrEqual(31);
  });
});

describe('scene CLI', () => {
  const NOW = new Date('2026-11-18T09:00:00Z');
  const none = () => false;
  it('parses arguments', () => {
    expect(parseArgs(['research', 'x.json', '--ttl', '30', '--level', 'high', '--url', 'ws://h:1', '--raw'], {})).toMatchObject({
      name: 'research', file: 'x.json', ttl: 30, level: 'high', url: 'ws://h:1', raw: true,
    });
    expect(parseArgs(['alert'], { MQTT_URL: 'mqtt://pi:1883', MQTT_USER: 'u', MQTT_PASS: 'p' })).toMatchObject({ url: 'mqtt://pi:1883', user: 'u', pass: 'p' });
    expect(() => parseArgs([], {})).toThrow(/usage/);
    expect(() => parseArgs(['idle', '--ttl', 'abc'], {})).toThrow(/ttl/);
    expect(() => parseArgs(['idle', '--ttl', '0'], {})).toThrow(/ttl/);
  });
  it('a bare name publishes a bare scene when there is no example file', () => {
    const p = JSON.parse(buildPayload(parseArgs(['idle'], {}), NOW, () => '', none));
    expect(p).toMatchObject({ v: 1, scene: 'idle', ts: NOW.toISOString() });
  });
  it('every shipped example publishes cleanly and carries a fresh ts', () => {
    for (const name of SCENES) {
      const payload = buildPayload(parseArgs([name], {}), NOW);
      const r = parseScene(payload);
      expect(r.ok, name).toBe(true);
      expect(JSON.parse(payload).ts).toBe(NOW.toISOString());
    }
  });
  it('--ttl and --level override the file', () => {
    const p = JSON.parse(buildPayload(parseArgs(['research', '--ttl', '5', '--level', 'medium'], {}), NOW));
    expect(p).toMatchObject({ ttl: 5, level: 'medium' });
  });
  it('rejects invalid scenes unless --raw', () => {
    const read = () => '{"v":1,"scene":"research","data":{"stat":{"sources":"many"}}}';
    expect(() => buildPayload(parseArgs(['research', 'bad.json'], {}), NOW, read, () => true)).toThrow(/invalid scene/);
    expect(buildPayload(parseArgs(['research', 'bad.json', '--raw'], {}), NOW, read, () => true)).toBe(read());
    expect(() => buildPayload(parseArgs(['research', 'bad.json'], {}), NOW, () => '{nope', () => true)).toThrow(/not valid JSON/);
    expect(buildPayload(parseArgs(['research', 'bad.json', '--raw'], {}), NOW, () => '{nope', () => true)).toBe('{nope');
  });
  it('unknown scene names and mismatching files are errors', () => {
    expect(() => buildPayload(parseArgs(['disco'], {}), NOW, () => '', none)).toThrow(/unknown scene/);
    expect(() => buildPayload(parseArgs(['alert', 'f.json'], {}), NOW, () => '{"v":1,"scene":"idle"}', () => true)).toThrow(/holds scene/);
    expect(() => buildPayload(parseArgs(['alert', 'missing.json'], {}), NOW, () => '', none)).toThrow(/not found/);
  });
});

const wait = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('virtual devices over a real (in-process) broker', () => {
  let broker: Broker;
  let sim: Sim;
  let spy: MqttClient;
  const seen: { topic: string; payload: string }[] = [];
  const url = () => `mqtt://127.0.0.1:${broker.port}`;
  const last = (topic: string) => seen.filter((m) => m.topic === topic).at(-1)?.payload;

  beforeEach(async () => {
    seen.length = 0;
    broker = await startBroker({ port: 0, wsPort: -1 });
    spy = mqtt.connect(url(), { reconnectPeriod: 0 });
    await new Promise<void>((r) => spy.once('connect', () => r()));
    spy.on('message', (topic, p) => seen.push({ topic, payload: p.toString() }));
    spy.subscribe('vega/#');
    sim = await runSim({ url: url(), intervalMs: 40, piIntervalMs: 60 });
    await wait(() => DEVICES.every((d) => last(deviceTopic(d.room, d.id, 'availability')) === 'online'));
  });
  afterEach(async () => {
    await sim.stop();
    spy.end(true);
    await broker.close();
  });

  it('publishes meta, availability and telemetry that all satisfy the contract', async () => {
    await wait(() => !!last('vega/system/pi') && !!last('vega/system/net') && !!last(deviceTopic('bedroom', 'env', 'state')));
    expect(sim.deviceKeys).toHaveLength(6);
    expect(DEVICES.filter((d) => d.kind === 'esp8266')).toHaveLength(5);
    expect(DEVICES.filter((d) => d.kind === 'esp32-s3')).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(20);
    for (const m of seen) {
      if (m.topic === UI_SCENE) continue;
      expect(parseMessage(m.topic, m.payload), `${m.topic} ${m.payload}`).not.toBeNull();
    }
  });

  it('environment state carries temperature, humidity and CO₂; the radar carries presence', async () => {
    await wait(() => !!last('vega/bedroom/env/state') && !!last('vega/bedroom/radar/state'));
    expect(JSON.parse(last('vega/bedroom/env/state')!)).toMatchObject({ v: 1, temp_c: expect.any(Number), humidity: expect.any(Number), co2_ppm: expect.any(Number) });
    expect(JSON.parse(last('vega/bedroom/radar/state')!)).toMatchObject({ v: 1, presence: expect.any(Boolean) });
  });

  it('a relay obeys `set` and reports its state', async () => {
    const topic = deviceTopic('livingroom', 'light', 'set');
    spy.publish(topic, JSON.stringify({ v: 1, on: true }));
    await wait(() => last('vega/livingroom/light/state') !== undefined && JSON.parse(last('vega/livingroom/light/state')!).on === true);
    spy.publish(topic, JSON.stringify({ v: 1, on: false }));
    await wait(() => JSON.parse(last('vega/livingroom/light/state')!).on === false);
  });

  it('a relay ignores malformed or invalid `set` payloads', async () => {
    const topic = deviceTopic('kitchen', 'plug', 'set');
    spy.publish(topic, '{broken');
    spy.publish(topic, JSON.stringify({ v: 1, on: 'yes' }));
    spy.publish(topic, JSON.stringify({ v: 1, on: true }));
    await wait(() => JSON.parse(last('vega/kitchen/plug/state')!).on === true);
  });

  it('a device that drops dead is reported offline by its Last Will, and can come back', async () => {
    await sim.killDevice('bedroom/env');
    await wait(() => last('vega/bedroom/env/availability') === 'offline');
    await sim.reviveDevice('bedroom/env');
    await wait(() => last('vega/bedroom/env/availability') === 'online');
  });

  it('a failing CI event makes the sim publish an alert scene; recovery publishes success', async () => {
    const scenes = () => seen.filter((m) => m.topic === UI_SCENE).map((m) => parseScene(m.payload));
    const countBefore = scenes().length;
    spy.publish('vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 'firmware-esp', failed: 1, ts: new Date().toISOString() }));
    await wait(() => scenes().length > countBefore);
    const alert = scenes().at(-1)!;
    expect(alert.ok && alert.scene).toMatchObject({ scene: 'alert', ttl: 60 });
    expect(alert.ok && alert.scene.data).toMatchObject({ title: 'build failed' });
    spy.publish('vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 'firmware-esp', failed: 0 }));
    await wait(() => scenes().at(-1)!.ok && (scenes().at(-1) as { ok: true; scene: { scene: string } }).scene.scene === 'success');
  });

  it('does not raise the alert again for the same failing state', async () => {
    const n = () => seen.filter((m) => m.topic === UI_SCENE).length;
    sim.setCi(1);
    await wait(() => n() === 1);
    sim.setCi(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(n()).toBe(1);
  });
});

describe('startBroker', () => {
  it('can be switched off and on again on the same ports', async () => {
    const a = await startBroker({ port: 0, wsPort: 0 });
    const { port, wsPort } = a;
    await a.close();
    const b = await startBroker({ port, wsPort });
    expect([b.port, b.wsPort]).toEqual([port, wsPort]);
    await b.close();
  });
});
