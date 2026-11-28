import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src';

const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const p = (t: string, payload: unknown) => parseMessage(t, typeof payload === 'string' ? payload : JSON.stringify(payload), NOW);

describe('parseMessage: valid input', () => {
  it('device state keeps only the fields present', () => {
    expect(p('vega/bedroom/sensor/state', { v: 1, ts: '2026-11-18T09:30:00Z', temp_c: 28.4, co2_ppm: 1180 })).toEqual({
      type: 'state', room: 'bedroom', deviceId: 'sensor', tempC: 28.4, co2Ppm: 1180, ts: Date.parse('2026-11-18T09:30:00Z'),
    });
    expect(p('vega/bedroom/radar/state', { v: 1, presence: true })).toEqual({ type: 'state', room: 'bedroom', deviceId: 'radar', presence: true, ts: NOW });
  });
  it('availability / meta / core', () => {
    expect(p('vega/bedroom/sensor/availability', 'offline')).toEqual({ type: 'availability', room: 'bedroom', deviceId: 'sensor', online: false });
    expect(p('vega/desk/core/meta', { v: 1, kind: 'esp32-s3', room_name: 'Desk' })).toEqual({ type: 'meta', room: 'desk', deviceId: 'core', kind: 'esp32-s3', roomName: 'Desk', name: null, aliases: [], risk: null });
    expect(p('vega/kitchen/plug/meta', { v: 1, kind: 'esp8266', name: 'Kettle', aliases: ['ổ cắm', 'plug'], risk: 'high' })).toMatchObject({ name: 'Kettle', aliases: ['ổ cắm', 'plug'], risk: 'high' });
    expect(p('vega/desk/core/state', { v: 1, state: 'listening' })).toEqual({ type: 'core', state: 'listening', mic: null });
    expect(p('vega/desk/core/state', { v: 1, state: 'idle', mic: 'off' })).toEqual({ type: 'core', state: 'idle', mic: 'off' });
    expect(p('vega/desk/camera/state', { v: 1, camera: 'missing' })).toEqual({ type: 'camera', present: false });
    expect(p('vega/desk/camera/state', { v: 1, camera: 'on' })).toEqual({ type: 'camera', present: true });
  });
  it('system topics', () => {
    expect(p('vega/system/events', { v: 1, type: 'ci', repo: 'r', failed: 2, ts: '2026-11-18T09:00:00Z' })).toMatchObject({ type: 'ci', failed: 2 });
    expect(p('vega/system/events', { v: 1, type: 'next_event', title: 't', at: '2026-11-18T12:00:00Z' })).toMatchObject({ type: 'nextEvent', detail: null });
    expect(p('vega/system/events', { v: 1, type: 'co2_series', room: 'b', values: [1, 2] })).toEqual({ type: 'co2Series', room: 'b', values: [1, 2], thresholdPpm: 1000, maxPpm: 1500 });
    expect(p('vega/system/events', { v: 1, type: 'command_result', id: 'a', result: 'ok' })).toEqual({ type: 'commandResult', id: 'a', result: 'ok', speak: null, sources: [], localAi: false });
    expect(p('vega/system/events', { v: 1, type: 'command_result', id: 'b', result: 'ok', local_ai: true })).toMatchObject({ type: 'commandResult', localAi: true });
    expect(p('vega/system/events/llm_usage', { v: 1, type: 'llm_usage', day: '2026-11-19', spent_usd: 0.0012, budget_usd: 0.05, calls: 4, tokens_in: 2800, tokens_out: 200 })).toEqual({
      type: 'llmUsage', day: '2026-11-19', spentUsd: 0.0012, budgetUsd: 0.05, calls: 4, tokensIn: 2800, tokensOut: 200,
    });
    expect(p('vega/system/pi', { v: 1, cpu_pct: 23, temp_c: 52 })).toEqual({ type: 'pi', cpuPct: 23, tempC: 52, memPct: null, uptimeS: null });
    expect(p('vega/system/net', { v: 1, latency_ms: 38 })).toEqual({ type: 'net', latencyMs: 38 });
  });
  it('events are accepted on the stream topic and on the retained per-type topics', () => {
    const ci = { v: 1, type: 'ci', repo: 'r', failed: 1 };
    expect(p('vega/system/events', ci)).toMatchObject({ type: 'ci' });
    expect(p('vega/system/events/ci', ci)).toMatchObject({ type: 'ci' });
    expect(p('vega/system/events/next_event', { v: 1, type: 'next_event', title: 't', at: '2026-11-18T12:00:00Z' })).toMatchObject({ type: 'nextEvent' });
    expect(p('vega/system/events/ci', { v: 1, type: 'nope' })).toBeNull();
  });
  it('scene', () => {
    expect(p('vega/ui/scene', { v: 1, scene: 'research' })).toMatchObject({ type: 'scene', scene: { scene: 'research' } });
  });
});

describe('parseMessage: bad input is dropped without throwing', () => {
  const bad: [string, unknown][] = [
    ['vega/bedroom/sensor/state', '{not json'],
    ['vega/bedroom/sensor/state', ''],
    ['vega/bedroom/sensor/state', 'null'],
    ['vega/bedroom/sensor/state', '[1,2]'],
    ['vega/bedroom/sensor/state', { temp_c: 20 }],
    ['vega/bedroom/sensor/state', { v: 2, temp_c: 20 }],
    ['vega/bedroom/sensor/state', { v: 1, temp_c: 'hot' }],
    ['vega/bedroom/sensor/state', { v: 1 }],
    ['vega/bedroom/sensor/availability', 'maybe'],
    ['vega/desk/core/state', { v: 1, state: 'dancing' }],
    ['vega/desk/camera/state', { v: 1, camera: 'maybe' }],
    ['vega/desk/core/meta', { v: 1, kind: 'toaster' }],
    ['vega/system/events', { v: 1, type: 'ci', repo: 1 }],
    ['vega/system/events', '\u0000\u0001'],
    ['vega/system/events', { v: 1, type: 'unknown' }],
    ['vega/system/pi', { v: 1, cpu_pct: 'x' }],
    ['vega/system/net', { v: 1 }],
    ['vega/system/command', { v: 1 }],
    ['vega/too/short', 'x'],
    ['other/a/b/state', { v: 1, co2_ppm: 1 }],
    ['vega/system/dev/state', { v: 1, co2_ppm: 1 }],
    ['vega/bedroom/fan/set', { v: 1, on: true }],
    ['vega/ui/scene', ''],
  ];
  for (const [topic, payload] of bad) {
    it(`${topic} <- ${JSON.stringify(payload)}`, () => {
      expect(() => p(topic, payload)).not.toThrow();
      expect(p(topic, payload)).toBeNull();
    });
  }
  it('a command the voice agent heard reaches screens; typed ones (from a screen itself) do not (v5)', () => {
    const ts = '2026-11-20T09:30:00Z';
    expect(p('vega/system/command', { v: 1, id: 'VOICE-1', text: 'phòng mấy độ', ts, via: 'voice' })).toEqual({ type: 'voiceCommand', id: 'VOICE-1', text: 'phòng mấy độ' });
    expect(p('vega/system/command', { v: 1, id: 'UI-1', text: 'phòng mấy độ', ts })).toBeNull();
    expect(p('vega/system/command', { v: 1, id: 'X', text: 'hi', ts, via: 'telepathy' })).toBeNull();
  });

  it('a bad scene is reported, not dropped silently', () => {
    expect(p('vega/ui/scene', '{oops')).toEqual({ type: 'sceneInvalid', error: 'invalid JSON' });
    expect(p('vega/ui/scene', { v: 1, scene: 'disco' })).toMatchObject({ type: 'sceneInvalid' });
  });
});
