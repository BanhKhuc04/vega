import { describe, expect, it } from 'vitest';
import { SYSTEM_PRESENCE, backupState, watchBeat, netStats, owntracksLocation, parseMessage, piStats, systemCommand, systemEvent, systemHealth } from '../src';

const ok = (schema: { safeParse: (x: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe('systemEvent', () => {
  it('accepts every event type', () => {
    expect(ok(systemEvent, { v: 1, type: 'ci', repo: 'firmware-esp', failed: 1 })).toBe(true);
    expect(ok(systemEvent, { v: 1, type: 'ci', repo: 'r', failed: 0, ts: '2026-11-18T09:26:00Z' })).toBe(true);
    expect(ok(systemEvent, { v: 1, type: 'next_event', title: 'lab report', detail: 'networks', at: '2026-11-18T09:30:00Z' })).toBe(true);
    expect(ok(systemEvent, { v: 1, type: 'co2_series', room: 'bedroom', values: [1, 2, 3] })).toBe(true);
    expect(ok(systemEvent, { v: 1, type: 'command_result', id: 'a', result: 'done' })).toBe(true);
  });
  it.each([
    ['unknown type', { v: 1, type: 'weather' }],
    ['ci repo wrong type', { v: 1, type: 'ci', repo: 5, failed: 1 }],
    ['ci negative', { v: 1, type: 'ci', repo: 'r', failed: -1 }],
    ['ci fractional', { v: 1, type: 'ci', repo: 'r', failed: 1.5 }],
    ['ci missing failed', { v: 1, type: 'ci', repo: 'r' }],
    ['next_event bad date', { v: 1, type: 'next_event', title: 't', at: 'soon' }],
    ['next_event missing title', { v: 1, type: 'next_event', at: '2026-11-18T09:30:00Z' }],
    ['co2 empty', { v: 1, type: 'co2_series', room: 'r', values: [] }],
    ['co2 non-number', { v: 1, type: 'co2_series', room: 'r', values: [1, 'x'] }],
    ['co2 too long', { v: 1, type: 'co2_series', room: 'r', values: Array(97).fill(1) }],
    ['command_result no id', { v: 1, type: 'command_result', result: 'x' }],
    ['command_result local_ai false', { v: 1, type: 'command_result', id: 'a', result: 'x', local_ai: false }],
    ['llm_usage bad day', { v: 1, type: 'llm_usage', day: 'today', spent_usd: 0, budget_usd: 0.05, calls: 0, tokens_in: 0, tokens_out: 0 }],
    ['llm_usage negative spend', { v: 1, type: 'llm_usage', day: '2026-11-19', spent_usd: -1, budget_usd: 0.05, calls: 0, tokens_in: 0, tokens_out: 0 }],
    ['no version', { type: 'ci', repo: 'r', failed: 0 }],
  ])('rejects %s', (_n, v) => expect(ok(systemEvent, v)).toBe(false));
});

describe('systemCommand / pi / net', () => {
  it('systemCommand', () => {
    expect(ok(systemCommand, { v: 1, id: 'a', text: 'hi', ts: '2026-11-18T09:30:00Z' })).toBe(true);
    expect(ok(systemCommand, { v: 1, id: 'a', text: '', ts: '2026-11-18T09:30:00Z' })).toBe(false);
    expect(ok(systemCommand, { v: 1, id: 'a', text: 'hi', ts: '2026-11-18T09:30:00Z', via: 'voice' })).toBe(true);
    expect(ok(systemCommand, { v: 1, id: 'a', text: 'hi', ts: '2026-11-18T09:30:00Z', via: 'mail' })).toBe(false);
    expect(ok(systemCommand, { v: 1, id: 'a', text: 'x' })).toBe(false);
  });
  it('piStats', () => {
    expect(ok(piStats, { v: 1, cpu_pct: 23, temp_c: 52, mem_pct: 40, uptime_s: 500000 })).toBe(true);
    expect(ok(piStats, { v: 1 })).toBe(true);
    expect(ok(piStats, { v: 1, cpu_pct: 140 })).toBe(false);
    expect(ok(piStats, { v: 1, temp_c: 'hot' })).toBe(false);
  });
  it('netStats', () => {
    expect(ok(netStats, { v: 1, latency_ms: 38 })).toBe(true);
    expect(ok(netStats, { v: 1 })).toBe(false);
    expect(ok(netStats, { v: 1, latency_ms: -1 })).toBe(false);
    expect(ok(netStats, { v: 1, latency_ms: '38' })).toBe(false);
  });
});

describe('M8: health, backup, presence, OwnTracks', () => {
  const ts = '2026-11-21T10:00:00Z';
  it('systemHealth', () => {
    expect(ok(systemHealth, { v: 1, ts, services: [{ name: 'vega-brain', state: 'running', health: 'healthy', restarts: 0 }] })).toBe(true);
    expect(ok(systemHealth, { v: 1, ts, services: [] })).toBe(true);
    expect(ok(systemHealth, { v: 1, ts, services: [{ name: 'x', state: 'running', health: 'sick', restarts: 0 }] })).toBe(false);
    expect(ok(systemHealth, { v: 1, ts, services: [{ name: 'x', state: 'running', health: 'none', restarts: -1 }] })).toBe(false);
    expect(ok(systemHealth, { v: 1, services: [] })).toBe(false);
  });
  it('watchBeat (v9)', () => {
    expect(ok(watchBeat, { v: 1, ts })).toBe(true);
    expect(ok(watchBeat, { v: 1 })).toBe(false);
    expect(ok(watchBeat, { v: 2, ts })).toBe(false);
  });
  it('backupState', () => {
    expect(ok(backupState, { v: 1, ts, ok: true, bytes: 1234, offsite: false })).toBe(true);
    expect(ok(backupState, { v: 1, ts, ok: false, offsite: false, error: 'age is not installed' })).toBe(true);
    expect(ok(backupState, { v: 1, ts, ok: 'yes', offsite: false })).toBe(false);
  });
  it('presence: parsed for the screen', () => {
    expect(parseMessage(SYSTEM_PRESENCE, JSON.stringify({ v: 1, ts, state: 'away' }))).toEqual({ type: 'presence', home: false });
    expect(parseMessage(SYSTEM_PRESENCE, JSON.stringify({ v: 1, ts, state: 'gone' }))).toBeNull();
  });
  it('owntracksLocation keeps the fields VEGA reads, rejects other message types', () => {
    const r = owntracksLocation.safeParse({ _type: 'location', lat: 21.03, lon: 105.85, acc: 12, tst: 1795000000, batt: 80, inregions: ['Nhà'] });
    expect(r.success && r.data).toEqual({ _type: 'location', lat: 21.03, lon: 105.85, acc: 12, tst: 1795000000, inregions: ['Nhà'] });
    expect(ok(owntracksLocation, { _type: 'transition', lat: 1, lon: 1, tst: 1 })).toBe(false);
    expect(ok(owntracksLocation, { _type: 'location', lat: 91, lon: 1, tst: 1 })).toBe(false);
  });
});
