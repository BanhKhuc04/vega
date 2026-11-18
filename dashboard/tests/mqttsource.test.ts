import { describe, expect, it, vi } from 'vitest';
import { COMMAND_TOPIC, MqttSource, SUBSCRIPTIONS } from '../src/lib/mqtt';
import type { MqttLikeClient } from '../src/lib/mqtt';

class FakeClient implements MqttLikeClient {
  h: Record<string, ((...a: never[]) => void)[]> = {};
  subs: string[][] = [];
  pubs: [string, string][] = [];
  ended = false;
  on(event: string, cb: (...a: never[]) => void) {
    (this.h[event] ??= []).push(cb);
    return this;
  }
  fire(event: string, ...args: unknown[]) {
    for (const cb of this.h[event] ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
  subscribe(t: readonly string[]) { this.subs.push([...t]); }
  publish(t: string, p: string) { this.pubs.push([t, p]); }
  end() { this.ended = true; }
}

const enc = new TextEncoder();
async function setup() {
  const client = new FakeClient();
  const src = new MqttSource({ url: 'ws://x', factory: async () => client, now: () => 1_000 });
  src.start();
  await Promise.resolve();
  await Promise.resolve();
  return { client, src };
}
const msg = (c: FakeClient, topic: string, payload: string) => c.fire('message', topic, enc.encode(payload));

describe('MqttSource', () => {
  it('starts as connecting, empty and not mock', async () => {
    const { src } = await setup();
    const s = src.getSnapshot();
    expect(s.connection).toBe('connecting');
    expect(s.isMock).toBe(false);
    expect(s.env).toBeNull();
    expect(s.history).toEqual([]);
  });

  it('subscribes on connect and applies messages', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    expect(client.subs[0]).toEqual([...SUBSCRIPTIONS]);
    expect(src.getSnapshot().connection).toBe('connected');
    msg(client, 'vega/bedroom/sensor/state', JSON.stringify({ v: 1, temp_c: 27, humidity: 60, co2_ppm: 1500 }));
    expect(src.getSnapshot().env).toMatchObject({ tempC: 27, co2Ppm: 1500 });
    msg(client, 'vega/bedroom/sensor/availability', 'offline');
    expect(src.getSnapshot().devices[0]).toMatchObject({ id: 'bedroom/sensor', online: false });
  });

  it('survives corrupt payloads and keeps previous data', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    msg(client, 'vega/bedroom/sensor/state', JSON.stringify({ v: 1, co2_ppm: 900 }));
    const before = src.getSnapshot();
    expect(() => {
      msg(client, 'vega/bedroom/sensor/state', '{oops');
      msg(client, 'vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 1 }));
      client.fire('message', 'vega/bedroom/sensor/state', new Uint8Array([0xff, 0xfe, 0x00]));
    }).not.toThrow();
    expect(src.getSnapshot().env).toEqual(before.env);
  });

  it('shows disconnected on close, keeps data, and recovers on reconnect', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    msg(client, 'vega/bedroom/sensor/state', JSON.stringify({ v: 1, co2_ppm: 900 }));
    client.fire('close');
    expect(src.getSnapshot().connection).toBe('disconnected');
    expect(src.getSnapshot().env?.co2Ppm).toBe(900); // not blanked
    client.fire('reconnect');
    expect(src.getSnapshot().connection).toBe('disconnected'); // no flapping while retrying
    client.fire('connect');
    expect(src.getSnapshot().connection).toBe('connected');
    expect(client.subs).toHaveLength(2); // re-subscribed after the reconnect
  });

  it('does not crash on client errors', async () => {
    const { client } = await setup();
    expect(() => client.fire('error', new Error('boom'))).not.toThrow();
  });

  it('publishes commands to vega/system/command when connected', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    const e = src.sendCommand(' tắt đèn ');
    expect(e?.text).toBe('tắt đèn');
    const [topic, payload] = client.pubs[0]!;
    expect(topic).toBe(COMMAND_TOPIC);
    expect(JSON.parse(payload)).toMatchObject({ v: 1, id: e!.id, text: 'tắt đèn' });
    expect(src.getSnapshot().history[0]).toBe(e);
    msg(client, 'vega/system/events', JSON.stringify({ v: 1, type: 'command_result', id: e!.id, result: 'xong' }));
    expect(src.getSnapshot().history[0]?.result).toBe('xong');
  });

  it('does not publish while disconnected and says so', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    client.fire('close');
    const e = src.sendCommand('x');
    expect(client.pubs).toHaveLength(0);
    expect(e?.result).toContain('mất kết nối');
    expect(src.sendCommand('  ')).toBeNull();
  });

  it('stop() closes the client', async () => {
    const { client, src } = await setup();
    src.stop();
    expect(client.ended).toBe(true);
  });

  it('reports disconnected if the client cannot be created', async () => {
    const src = new MqttSource({ url: 'ws://x', factory: () => Promise.reject(new Error('no')) });
    const fn = vi.fn();
    src.subscribe(fn);
    src.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(src.getSnapshot().connection).toBe('disconnected');
  });
});
