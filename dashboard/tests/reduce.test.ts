import { describe, expect, it } from 'vitest';
import { parseMessage } from '@vega/contract';
import { applyUpdate } from '../src/data/reduce';
import { emptySnapshot } from '../src/data/sample';

const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const up = (topic: string, payload: unknown) => {
  const u = parseMessage(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), NOW);
  if (!u) throw new Error(`fixture rejected: ${topic}`);
  return u;
};
const fresh = () => emptySnapshot('mqtt', 'bedroom');

describe('applyUpdate', () => {
  it('merges partial readings and room names regardless of arrival order', () => {
    let s = fresh();
    s = applyUpdate(s, up('vega/bedroom/env/meta', { v: 1, kind: 'esp8266', room_name: 'Bedroom' }));
    s = applyUpdate(s, up('vega/bedroom/env/state', { v: 1, temp_c: 28, co2_ppm: 1100 }));
    s = applyUpdate(s, up('vega/bedroom/env/state', { v: 1, humidity: 70 }));
    expect(s.env).toMatchObject({ roomName: 'Bedroom', tempC: 28, humidity: 70, co2Ppm: 1100 });
    expect(s.devices).toEqual([{ id: 'bedroom/env', kind: 'esp8266', online: false }]);
  });
  it('only the primary room drives the Idle readings (no flip-flop between rooms)', () => {
    let s = fresh();
    s = applyUpdate(s, up('vega/bedroom/env/state', { v: 1, temp_c: 28, co2_ppm: 1100 }));
    s = applyUpdate(s, up('vega/balcony/env/state', { v: 1, temp_c: 35, co2_ppm: 400 }));
    expect(s.env).toMatchObject({ room: 'bedroom', tempC: 28, co2Ppm: 1100 });
    expect(s.devices.map((d) => d.id).sort()).toEqual(['balcony/env', 'bedroom/env']);
  });
  it('keeps a rolling 24-value CO₂ sparkline', () => {
    let s = fresh();
    for (let i = 0; i < 30; i++) s = applyUpdate(s, up('vega/bedroom/env/state', { v: 1, co2_ppm: 1000 + i }));
    expect(s.co2Spark).toHaveLength(24);
    expect(s.co2Spark.at(-1)).toBe(1029);
  });
  it('a co2_series seeds an empty sparkline once', () => {
    let s = fresh();
    s = applyUpdate(s, up('vega/system/events', { v: 1, type: 'co2_series', room: 'bedroom', values: Array.from({ length: 30 }, (_, i) => i) }));
    expect(s.co2Spark).toHaveLength(24);
    expect(s.co2Spark[0]).toBe(6);
    expect(s.co2Series?.values).toHaveLength(30);
  });
  it('presence comes from the primary room', () => {
    let s = fresh();
    s = applyUpdate(s, up('vega/bedroom/radar/state', { v: 1, presence: true }));
    expect(s.presence).toBe(true);
    s = applyUpdate(s, up('vega/bedroom/radar/state', { v: 1, presence: false }));
    expect(s.presence).toBe(false);
  });
  it('availability toggles one device immediately', () => {
    let s = fresh();
    s = applyUpdate(s, up('vega/a/b/availability', 'online'));
    s = applyUpdate(s, up('vega/a/c/availability', 'online'));
    s = applyUpdate(s, up('vega/a/b/availability', 'offline'));
    expect(s.devices.map((d) => [d.id, d.online])).toEqual([['a/b', false], ['a/c', true]]);
  });
  it('ci / next / pi / net / core', () => {
    let s = fresh();
    s = applyUpdate(s, up('vega/system/events', { v: 1, type: 'ci', repo: 'r', failed: 2, ts: '2026-11-18T09:00:00Z' }));
    s = applyUpdate(s, up('vega/system/events', { v: 1, type: 'next_event', title: 't', detail: 'd', at: '2026-11-18T12:00:00Z' }));
    s = applyUpdate(s, up('vega/system/pi', { v: 1, cpu_pct: 20, temp_c: 55 }));
    s = applyUpdate(s, up('vega/system/net', { v: 1, latency_ms: 40 }));
    s = applyUpdate(s, up('vega/desk/core/state', { v: 1, state: 'alert' }));
    expect(s.ci).toMatchObject({ repo: 'r', failed: 2 });
    expect(s.next).toMatchObject({ title: 't', detail: 'd' });
    expect(s.pi).toMatchObject({ cpuPct: 20, tempC: 55 });
    expect(s.net).toEqual({ latencyMs: 40 });
    expect(s.core).toBe('alert');
  });
  it('scenes and command results do not touch state', () => {
    const s = fresh();
    expect(applyUpdate(s, up('vega/ui/scene', { v: 1, scene: 'idle' }))).toBe(s);
    expect(applyUpdate(s, { type: 'commandResult', id: 'a', result: 'x', speak: null, sources: [] })).toBe(s);
    expect(applyUpdate(s, { type: 'llmUsage', day: '2026-11-19', spentUsd: 0.001, budgetUsd: 0.05, calls: 2, tokensIn: 900, tokensOut: 60 }).ai).toEqual({ day: '2026-11-19', spentUsd: 0.001, budgetUsd: 0.05, calls: 2 });
  });
});
