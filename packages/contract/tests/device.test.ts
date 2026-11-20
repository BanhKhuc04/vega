import { describe, expect, it } from 'vitest';
import { availability, coreState, deviceMeta, deviceState, relaySet } from '../src';

const ok = (schema: { safeParse: (x: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe('deviceState', () => {
  it('accepts any non-empty subset of readings', () => {
    expect(ok(deviceState, { v: 1, ts: '2026-11-18T09:30:00Z', temp_c: 28.4, humidity: 72, co2_ppm: 1180 })).toBe(true);
    expect(ok(deviceState, { v: 1, co2_ppm: 900 })).toBe(true);
    expect(ok(deviceState, { v: 1, presence: false })).toBe(true);
    expect(ok(deviceState, { v: 1, on: true })).toBe(true);
  });
  it.each([
    ['missing version', { co2_ppm: 1 }],
    ['wrong version', { v: 2, co2_ppm: 1 }],
    ['no readings', { v: 1 }],
    ['only a timestamp', { v: 1, ts: '2026-11-18T09:30:00Z' }],
    ['wrong type', { v: 1, temp_c: 'hot' }],
    ['NaN', { v: 1, co2_ppm: Number.NaN }],
    ['out of range', { v: 1, humidity: 140 }],
    ['bad timestamp', { v: 1, ts: 'yesterday', co2_ppm: 1 }],
    ['not an object', [1, 2]],
    ['null', null],
  ])('rejects %s', (_n, v) => expect(ok(deviceState, v)).toBe(false));
});

describe('deviceMeta', () => {
  it('accepts valid meta', () => {
    expect(ok(deviceMeta, { v: 1, kind: 'esp8266' })).toBe(true);
    expect(ok(deviceMeta, { v: 1, kind: 'esp32-s3', room_name: 'Phòng ngủ' })).toBe(true);
    expect(ok(deviceMeta, { v: 1, kind: 'esp8266', aliases: ['đèn', 'light'], risk: 'low' })).toBe(true);
  });
  it.each([
    { v: 1 },
    { v: 1, kind: 'toaster' },
    { v: 1, kind: 'esp8266', room_name: 5 },
    { v: 1, kind: 'esp8266', room_name: '' },
    { v: 1, kind: 'esp8266', aliases: [''] },
    { v: 1, kind: 'esp8266', aliases: 'đèn' },
    { v: 1, kind: 'esp8266', aliases: Array(9).fill('x') },
    { v: 1, kind: 'esp8266', risk: 'medium' },
  ])('rejects %j', (v) =>
    expect(ok(deviceMeta, v)).toBe(false),
  );
});

describe('availability', () => {
  it('is a plain string, case and space tolerant', () => {
    expect(availability.parse('online')).toBe('online');
    expect(availability.parse(' OFFLINE\n')).toBe('offline');
  });
  it.each(['', 'maybe', '{"v":1}'])('rejects %j', (v) => expect(availability.safeParse(v).success).toBe(false));
  it('rejects non-strings', () => expect(availability.safeParse(1).success).toBe(false));
});

describe('relaySet / coreState', () => {
  it('relaySet needs a boolean', () => {
    expect(ok(relaySet, { v: 1, on: false })).toBe(true);
    expect(ok(relaySet, { v: 1, on: 'yes' })).toBe(false);
    expect(ok(relaySet, { v: 1 })).toBe(false);
  });
  it('coreState needs a known state', () => {
    for (const state of ['idle', 'listening', 'thinking', 'speaking', 'alert', 'sleep']) expect(ok(coreState, { v: 1, state })).toBe(true);
    expect(ok(coreState, { v: 1, state: 'dancing' })).toBe(false);
    for (const mic of ['on', 'off', 'missing']) expect(ok(coreState, { v: 1, state: 'idle', mic })).toBe(true);
    expect(ok(coreState, { v: 1, state: 'idle', mic: 'loud' })).toBe(false);
    expect(ok(coreState, { v: 1 })).toBe(false);
  });
});
