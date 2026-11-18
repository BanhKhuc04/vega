import { afterEach, describe, expect, it } from 'vitest';
import { DASHBOARD_SUBSCRIPTIONS } from '@vega/contract';
import { MiniMqttClient } from '../src/data/minimqtt';
import { MqttSource } from '../src/data/mqtt-source';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import mqtt from 'mqtt';

const wait = async (cond: () => boolean, ms = 6000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let broker: Broker | null = null;
afterEach(async () => {
  await broker?.close();
  broker = null;
});

/** The dashboard's own client talking to a real MQTT broker over WebSocket. */
describe('MiniMqttClient against a real broker', () => {
  it('connects with the mqtt subprotocol, gets retained messages and live ones, and can publish', async () => {
    broker = await startBroker({ port: 0, wsPort: 0 });
    const pub = mqtt.connect(`mqtt://127.0.0.1:${broker.port}`, { reconnectPeriod: 0 });
    await new Promise<void>((r) => pub.once('connect', () => r()));
    pub.publish('vega/bedroom/env/state', '{"v":1,"co2_ppm":900}', { retain: true });
    await new Promise((r) => setTimeout(r, 50));

    const got: string[] = [];
    const c = new MiniMqttClient(`ws://127.0.0.1:${broker.wsPort}`, { clientId: 'test-ui' });
    c.on('message', (t, p) => got.push(`${t}=${new TextDecoder().decode(p)}`));
    await new Promise<void>((r) => c.on('connect', () => r()));
    c.subscribe(DASHBOARD_SUBSCRIPTIONS);
    await wait(() => got.length === 1);
    expect(got[0]).toBe('vega/bedroom/env/state={"v":1,"co2_ppm":900}');
    pub.publish('vega/system/net', '{"v":1,"latency_ms":40}');
    await wait(() => got.length === 2);

    let seen = '';
    pub.on('message', (_t, p) => (seen = p.toString()));
    await pub.subscribeAsync('vega/system/command'); // wait for the SUBACK so the publish below cannot race it
    c.publish('vega/system/command', '{"v":1,"id":"a","text":"hi","ts":"2026-11-18T09:00:00Z"}');
    await wait(() => seen !== '');
    expect(JSON.parse(seen)).toMatchObject({ text: 'hi' });
    c.end();
    pub.end(true);
  });

  it('MqttSource: LIVE, then RECONNECTING when the broker dies (data kept), then LIVE again by itself', async () => {
    broker = await startBroker({ port: 0, wsPort: 0 });
    const { port, wsPort } = broker;
    const pub = mqtt.connect(`mqtt://127.0.0.1:${port}`, { reconnectPeriod: 0 });
    await new Promise<void>((r) => pub.once('connect', () => r()));
    const src = new MqttSource({ url: `ws://127.0.0.1:${wsPort}` });
    src.start();
    await wait(() => src.getSnapshot().conn === 'live');
    pub.publish('vega/bedroom/env/state', '{"v":1,"temp_c":27.5,"humidity":50,"co2_ppm":1111}');
    await wait(() => src.getSnapshot().env?.co2Ppm === 1111);
    pub.end(true);

    await broker.close();
    await wait(() => src.getSnapshot().conn === 'reconnecting');
    expect(src.getSnapshot().env?.co2Ppm).toBe(1111); // last state still there: nothing went blank

    broker = await startBroker({ port, wsPort });
    await wait(() => src.getSnapshot().conn === 'live', 10_000);
    const pub2 = mqtt.connect(`mqtt://127.0.0.1:${port}`, { reconnectPeriod: 0 });
    await new Promise<void>((r) => pub2.once('connect', () => r()));
    pub2.publish('vega/bedroom/env/state', '{"v":1,"temp_c":20,"humidity":40,"co2_ppm":500}');
    await wait(() => src.getSnapshot().env?.co2Ppm === 500);
    pub2.end(true);
    src.stop();
  });

  it('MqttSource: OFFLINE when there is no broker at all', async () => {
    const src = new MqttSource({ url: 'ws://127.0.0.1:1' });
    src.start();
    await wait(() => src.getSnapshot().conn === 'offline', 8000);
    src.stop();
  });
});
