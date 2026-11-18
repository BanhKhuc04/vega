import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/lib/parse';
import { applyUpdate } from '../src/lib/reduce';
import { emptySnapshot } from '../src/lib/mqtt';

const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const p = (t: string, payload: unknown) => parseMessage(t, typeof payload === 'string' ? payload : JSON.stringify(payload), NOW);

describe('parseMessage: valid input', () => {
  it('environment state', () => {
    expect(p('vega/bedroom/sensor/state', { v: 1, ts: '2026-11-18T09:30:00Z', temp_c: 28.4, humidity: 72, co2_ppm: 1180 })).toEqual({
      type: 'env', room: 'bedroom', deviceId: 'sensor', tempC: 28.4, humidity: 72, co2Ppm: 1180, ts: Date.parse('2026-11-18T09:30:00Z'),
    });
  });
  it('partial environment state', () => {
    expect(p('vega/bedroom/sensor/state', { v: 1, co2_ppm: 900 })).toMatchObject({ type: 'env', co2Ppm: 900, tempC: null, humidity: null, ts: NOW });
  });
  it('availability is a plain string', () => {
    expect(p('vega/bedroom/sensor/availability', 'offline')).toEqual({ type: 'availability', room: 'bedroom', deviceId: 'sensor', online: false });
    expect(p('vega/bedroom/sensor/availability', ' ONLINE ')).toMatchObject({ online: true });
  });
  it('meta', () => {
    expect(p('vega/desk/core/meta', { v: 1, kind: 'esp32-s3', room_name: 'Bàn' })).toEqual({ type: 'meta', room: 'desk', deviceId: 'core', kind: 'esp32-s3', roomName: 'Bàn' });
    expect(p('vega/x/y/meta', { v: 1, kind: 'weird' })).toMatchObject({ kind: 'unknown', roomName: null });
  });
  it('core state', () => {
    expect(p('vega/desk/core/state', { v: 1, state: 'listening' })).toEqual({ type: 'core', state: 'listening' });
  });
  it('system events', () => {
    expect(p('vega/system/events', { v: 1, type: 'ci', repo: 'r', failed: 2, ts: '2026-11-18T09:00:00Z' })).toMatchObject({ type: 'ci', failed: 2 });
    expect(p('vega/system/events', { v: 1, type: 'next_event', title: 't', at: '2026-11-18T12:00:00Z' })).toMatchObject({ type: 'next' });
    expect(p('vega/system/events', { v: 1, type: 'co2_series', room: 'bedroom', values: [1, 2, 3] })).toEqual({ type: 'co2', room: 'bedroom', values: [1, 2, 3], thresholdPpm: 1000, maxPpm: 1500 });
    expect(p('vega/system/events', { v: 1, type: 'command_result', id: 'a', result: 'ok' })).toEqual({ type: 'commandResult', id: 'a', result: 'ok' });
  });
  it('research session', () => {
    const u = p('vega/system/events', {
      v: 1, type: 'research',
      session: { id: 'a', title: 'T', step_no: 1, step_count: 2, phase: 'x', steps: [{ label: 'l', state: 'active', progress: 2 }], compare: { title: 'c', columns: ['a'], rows: [{ label: 'r', cells: [{ text: 't', tone: 'bad' }] }] } },
    });
    expect(u).toMatchObject({ type: 'research', session: { id: 'a', steps: [{ progress: 1 }], compare: { rows: [{ cells: [{ tone: 'plain' }] }] } } });
  });
});

describe('parseMessage: bad input is ignored without throwing', () => {
  const bad: [string, unknown][] = [
    ['vega/bedroom/sensor/state', '{not json'],
    ['vega/bedroom/sensor/state', ''],
    ['vega/bedroom/sensor/state', 'null'],
    ['vega/bedroom/sensor/state', '[1,2]'],
    ['vega/bedroom/sensor/state', { temp_c: 20 }], // no version
    ['vega/bedroom/sensor/state', { v: 2, temp_c: 20 }], // unknown version
    ['vega/bedroom/sensor/state', { v: 1, temp_c: 'hot' }], // wrong type
    ['vega/bedroom/sensor/state', { v: 1, temp_c: null, humidity: null }], // nothing to show
    ['vega/bedroom/sensor/state', { v: 1, co2_ppm: Number.NaN }],
    ['vega/bedroom/sensor/availability', 'maybe'],
    ['vega/desk/core/state', { v: 1, state: 'dancing' }],
    ['vega/system/events', { v: 1, type: 'ci', repo: 5, failed: 1 }],
    ['vega/system/events', { v: 1, type: 'ci', repo: 'r', failed: -1 }],
    ['vega/system/events', { v: 1, type: 'next_event', title: 't', at: 'not a date' }],
    ['vega/system/events', { v: 1, type: 'co2_series', room: 'r', values: [] }],
    ['vega/system/events', { v: 1, type: 'co2_series', room: 'r', values: [1, 'x'] }],
    ['vega/system/events', { v: 1, type: 'research', session: { id: 'a' } }],
    ['vega/system/events', { v: 1, type: 'unknown' }],
    ['vega/system/events', '\u0000\u0001'],
    ['vega/system/command', { v: 1 }],
    ['vega/too/short', 'x'],
    ['other/a/b/state', { v: 1, co2_ppm: 1 }],
    ['vega/system/dev/state', { v: 1, co2_ppm: 1 }], // reserved room
  ];
  for (const [topic, payload] of bad) {
    it(`${topic} <- ${JSON.stringify(payload)}`, () => {
      expect(() => p(topic, payload)).not.toThrow();
      expect(p(topic, payload)).toBeNull();
    });
  }
});

describe('applyUpdate', () => {
  it('merges partial environment readings and room names regardless of arrival order', () => {
    let s = emptySnapshot();
    s = applyUpdate(s, p('vega/bedroom/sensor/meta', { v: 1, kind: 'esp8266', room_name: 'Phòng ngủ' })!);
    s = applyUpdate(s, p('vega/bedroom/sensor/state', { v: 1, temp_c: 28, co2_ppm: 1100 })!);
    s = applyUpdate(s, p('vega/bedroom/sensor/state', { v: 1, humidity: 70 })!);
    expect(s.env).toMatchObject({ roomName: 'Phòng ngủ', tempC: 28, humidity: 70, co2Ppm: 1100 });
    expect(s.devices).toEqual([{ id: 'bedroom/sensor', kind: 'esp8266', online: false }]);
  });
  it('availability toggles one device immediately', () => {
    let s = emptySnapshot();
    s = applyUpdate(s, p('vega/a/b/availability', 'online')!);
    s = applyUpdate(s, p('vega/a/c/availability', 'online')!);
    s = applyUpdate(s, p('vega/a/b/availability', 'offline')!);
    expect(s.devices.map((d) => [d.id, d.online])).toEqual([['a/b', false], ['a/c', true]]);
  });
  it('command_result updates only the matching history entry', () => {
    const s0 = { ...emptySnapshot(), history: [{ id: 'x', ts: 1, text: 't', result: '…', session: null }, { id: 'y', ts: 2, text: 'u', result: '…', session: null }] };
    const s1 = applyUpdate(s0, { type: 'commandResult', id: 'y', result: 'done' });
    expect(s1.history.map((h) => h.result)).toEqual(['…', 'done']);
  });
});
