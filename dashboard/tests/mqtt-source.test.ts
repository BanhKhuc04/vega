import { describe, expect, it, vi } from 'vitest';
import { DASHBOARD_SUBSCRIPTIONS, SYSTEM_COMMAND } from '@vega/contract';
import { MqttSource } from '../src/data/mqtt-source';
import type { MqttLikeClient } from '../src/data/mqtt-source';

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
async function setup(warn = vi.fn()) {
  const client = new FakeClient();
  const src = new MqttSource({ url: 'ws://x', factory: async () => client, now: () => 1_000, warn });
  src.start();
  await Promise.resolve();
  await Promise.resolve();
  return { client, src, warn };
}
const msg = (c: FakeClient, topic: string, payload: string) => c.fire('message', topic, enc.encode(payload));

describe('MqttSource', () => {
  it('starts empty, not sample, header says RECONNECTING while the first connect is pending', async () => {
    const { src } = await setup();
    const s = src.getSnapshot();
    expect(s.conn).toBe('reconnecting');
    expect(s.isSample).toBe(false);
    expect(s.env).toBeNull();
  });

  it('subscribes on connect and applies messages', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    expect(client.subs[0]).toEqual([...DASHBOARD_SUBSCRIPTIONS]);
    expect(src.getSnapshot().conn).toBe('live');
    msg(client, 'vega/bedroom/env/state', JSON.stringify({ v: 1, temp_c: 27, humidity: 60, co2_ppm: 1500 }));
    expect(src.getSnapshot().env).toMatchObject({ tempC: 27, co2Ppm: 1500 });
    msg(client, 'vega/bedroom/env/availability', 'offline');
    expect(src.getSnapshot().devices[0]).toMatchObject({ id: 'bedroom/env', online: false });
  });

  it('voice agent: heard commands go to their listeners (typed ones do not), mic state lands in the snapshot', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    expect(client.subs[0]).toContain(SYSTEM_COMMAND);
    const heard: [string, string][] = [];
    src.onVoiceCommand((id, text) => heard.push([id, text]));
    const ts = '2026-11-20T09:00:00Z';
    msg(client, SYSTEM_COMMAND, JSON.stringify({ v: 1, id: 'VOICE-1', text: 'bật đèn', ts, via: 'voice' }));
    msg(client, SYSTEM_COMMAND, JSON.stringify({ v: 1, id: 'UI-1', text: 'bật đèn', ts }));
    expect(heard).toEqual([['VOICE-1', 'bật đèn']]);
    expect(src.getSnapshot().mic).toBeNull();
    msg(client, 'vega/desk/core/state', JSON.stringify({ v: 1, state: 'idle', mic: 'off' }));
    expect(src.getSnapshot()).toMatchObject({ core: 'idle', mic: 'off' });
    msg(client, 'vega/desk/core/state', JSON.stringify({ v: 1, state: 'listening' })); // an ESP core without a mic field keeps it
    expect(src.getSnapshot()).toMatchObject({ core: 'listening', mic: 'off' });
  });
  it('camera state from the brain lands in the snapshot (M7)', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    expect(src.getSnapshot().camera).toBeNull();
    msg(client, 'vega/desk/camera/state', JSON.stringify({ v: 1, camera: 'missing' }));
    expect(src.getSnapshot().camera).toBe(false);
    msg(client, 'vega/desk/camera/state', JSON.stringify({ v: 1, camera: 'on' }));
    expect(src.getSnapshot().camera).toBe(true);
  });

  it('survives corrupt payloads and keeps previous data', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    msg(client, 'vega/bedroom/env/state', JSON.stringify({ v: 1, co2_ppm: 900 }));
    const before = src.getSnapshot();
    expect(() => {
      msg(client, 'vega/bedroom/env/state', '{oops');
      msg(client, 'vega/system/events', JSON.stringify({ v: 1, type: 'ci', repo: 1 }));
      client.fire('message', 'vega/bedroom/env/state', new Uint8Array([0xff, 0xfe, 0x00]));
    }).not.toThrow();
    expect(src.getSnapshot().env).toEqual(before.env);
  });

  it('RECONNECTING after a drop, data kept, back to LIVE and re-subscribed after reconnect', async () => {
    const { client, src } = await setup();
    client.fire('connect');
    msg(client, 'vega/bedroom/env/state', JSON.stringify({ v: 1, co2_ppm: 900 }));
    client.fire('close');
    expect(src.getSnapshot().conn).toBe('reconnecting');
    expect(src.getSnapshot().env?.co2Ppm).toBe(900); // last scene/data kept, not blanked
    client.fire('reconnect');
    expect(src.getSnapshot().conn).toBe('reconnecting'); // no flapping while retrying
    client.fire('connect');
    expect(src.getSnapshot().conn).toBe('live');
    expect(client.subs).toHaveLength(2);
  });

  it('OFFLINE when the broker was never reachable', async () => {
    const { client, src } = await setup();
    client.fire('close');
    expect(src.getSnapshot().conn).toBe('offline');
    client.fire('reconnect');
    expect(src.getSnapshot().conn).toBe('offline');
    client.fire('connect');
    expect(src.getSnapshot().conn).toBe('live');
  });

  it('OFFLINE when the client cannot even be created', async () => {
    const src = new MqttSource({ url: 'ws://x', factory: () => Promise.reject(new Error('no')) });
    src.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(src.getSnapshot().conn).toBe('offline');
  });

  it('does not crash on client errors', async () => {
    const { client } = await setup();
    expect(() => client.fire('error', new Error('boom'))).not.toThrow();
  });

  it('delivers valid scenes, warns once for a run of invalid ones', async () => {
    const { client, src, warn } = await setup();
    client.fire('connect');
    const got = vi.fn();
    src.onScene(got);
    msg(client, 'vega/ui/scene', JSON.stringify({ v: 1, scene: 'research', data: { title: 'T' } }));
    expect(got).toHaveBeenCalledTimes(1);
    expect(got.mock.calls[0]![0]).toMatchObject({ scene: 'research' });
    msg(client, 'vega/ui/scene', '{broken');
    msg(client, 'vega/ui/scene', JSON.stringify({ v: 1, scene: 'disco' }));
    msg(client, 'vega/ui/scene', JSON.stringify({ v: 1, scene: 'idle', ttl: 'x' }));
    expect(got).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1); // once
    msg(client, 'vega/ui/scene', JSON.stringify({ v: 1, scene: 'idle' }));
    msg(client, 'vega/ui/scene', '{broken again');
    expect(warn).toHaveBeenCalledTimes(2); // a valid scene re-arms the warning
  });

  it('publishes typed commands only while connected', async () => {
    const { client, src } = await setup();
    expect(src.sendCommand('early')).toBeNull();
    client.fire('connect');
    const id = src.sendCommand(' turn off the light ');
    expect(id).toMatch(/^UI-/);
    const [topic, payload] = client.pubs[0]!;
    expect(topic).toBe(SYSTEM_COMMAND);
    expect(JSON.parse(payload)).toMatchObject({ v: 1, id, text: 'turn off the light' });
    expect(src.sendCommand('  ')).toBeNull();
    client.fire('close');
    expect(src.sendCommand('x')).toBeNull();
    expect(client.pubs).toHaveLength(1);
  });

  it('passes the brain answers (command_result) on with their command id', async () => {
    const { client, src } = await setup();
    const got: [string, string][] = [];
    const extras: unknown[] = [];
    src.onResult((id, text, extra) => {
      got.push([id, text]);
      extras.push(extra);
    });
    msg(client, 'vega/system/events/command_result', JSON.stringify({ v: 1, type: 'command_result', id: 'UI-1', result: 'Xin chào!' }));
    msg(client, 'vega/system/events/command_result', '{broken');
    msg(client, 'vega/system/events/command_result', JSON.stringify({ v: 1, type: 'command_result', id: 'UI-2', result: 'A [1]', speak: 'A.', sources: [{ n: 1, title: 'T', url: 'https://x.example.com/' }] }));
    msg(client, 'vega/system/events/command_result', JSON.stringify({ v: 1, type: 'command_result', id: 'UI-3', result: 'bad', sources: [{ n: 1, title: 'T', url: 'javascript:alert(1)' }] }));
    expect(got).toEqual([['UI-1', 'Xin chào!'], ['UI-2', 'A [1]']]);
    expect(extras).toEqual([{ speak: null, sources: [] }, { speak: 'A.', sources: [{ n: 1, title: 'T', url: 'https://x.example.com/' }] }]);
  });

  it('an answer from the PC model turns LOCAL AI on, the next answer without it turns it off (M15)', async () => {
    const { client, src } = await setup();
    msg(client, 'vega/system/events/command_result', JSON.stringify({ v: 1, type: 'command_result', id: 'UI-1', result: 'Chào', local_ai: true }));
    expect(src.getSnapshot().localAi).toBe(true);
    msg(client, 'vega/system/events/command_result', JSON.stringify({ v: 1, type: 'command_result', id: 'UI-2', result: 'Living room light on' }));
    expect(src.getSnapshot().localAi).toBe(false);
  });

  it('passes on what the brain says on its own (announce)', async () => {
    const { client, src } = await setup();
    const got: string[] = [];
    src.onAnnounce((text) => got.push(text));
    msg(client, 'vega/system/events/announce', JSON.stringify({ v: 1, type: 'announce', text: 'Nhắc bạn: gọi mẹ', ts: new Date().toISOString() }));
    msg(client, 'vega/system/events/announce', JSON.stringify({ v: 1, type: 'announce', text: '', ts: new Date().toISOString() }));
    expect(got).toEqual(['Nhắc bạn: gọi mẹ']);
  });

  it('stop() closes the client', async () => {
    const { client, src } = await setup();
    src.stop();
    expect(client.ended).toBe(true);
  });
});
