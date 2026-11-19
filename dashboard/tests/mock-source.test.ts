import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSource, simStep } from '../src/data/mock-source';
import { BASELINE, SAMPLE_CO2, nextLocal, sampleSnapshot } from '../src/data/sample';

const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const rng = (v: number) => () => v;

describe('MockSource (SIM mode)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts with the template baseline, flagged as sample data and SIM', () => {
    const s = new MockSource({ now: () => NOW }).getSnapshot();
    expect(s.isSample).toBe(true);
    expect(s.conn).toBe('sim');
    expect(s.sourceKind).toBe('mock');
    expect(s.env).toMatchObject({ roomName: 'Bedroom', tempC: 28.4, humidity: 72, co2Ppm: 1180 });
    expect(s.devices).toHaveLength(6);
    expect(s.devices.filter((d) => d.kind === 'esp8266')).toHaveLength(5);
    expect(s.devices.filter((d) => d.kind === 'esp32-s3')).toHaveLength(1);
    expect(s.devices.every((d) => d.online)).toBe(true);
    expect(s.ci).toMatchObject({ repo: 'firmware-esp', failed: 1 });
    expect(s.next).toMatchObject({ title: 'lab report', detail: 'computer networks' });
    expect(s.pi).toMatchObject({ tempC: 52 });
    expect(s.net?.latencyMs).toBe(38);
    expect(s.presence).toBe(true);
    expect(s.co2Spark).toHaveLength(24);
    expect(s.co2Series?.values).toEqual(SAMPLE_CO2);
  });

  it('next event is the next 16:30 local time in the future', () => {
    const at = nextLocal(16, 30, NOW);
    expect(at).toBeGreaterThan(NOW);
    expect(at - NOW).toBeLessThanOrEqual(24 * 3600_000);
    const d = new Date(at);
    expect([d.getHours(), d.getMinutes()]).toEqual([16, 30]);
  });

  it('emits on start, then every interval, until stopped', () => {
    const src = new MockSource({ now: () => NOW, rng: rng(0.5), intervalMs: 2000 });
    const fn = vi.fn();
    src.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    src.start();
    src.start(); // idempotent
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(6000);
    expect(fn).toHaveBeenCalledTimes(5);
    src.stop();
    vi.advanceTimersByTime(6000);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('unsubscribe works; scenes and commands are no-ops in SIM', () => {
    const src = new MockSource({ now: () => NOW });
    const fn = vi.fn();
    const off = src.subscribe(fn);
    off();
    src.step();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(src.sendCommand('x')).toBeNull();
    expect(typeof src.onScene(() => {})).toBe('function');
  });
});

describe('simStep', () => {
  const base = sampleSnapshot(NOW);
  it('stays inside the template ranges', () => {
    for (const r of [0, 0.5, 0.999]) {
      const s = simStep(base, NOW, rng(r));
      expect(s.env!.tempC!).toBeGreaterThanOrEqual(28.2);
      expect(s.env!.tempC!).toBeLessThanOrEqual(28.7);
      expect(s.env!.humidity!).toBeGreaterThanOrEqual(70);
      expect(s.env!.humidity!).toBeLessThanOrEqual(74);
      expect(s.env!.co2Ppm!).toBeGreaterThanOrEqual(1160);
      expect(s.env!.co2Ppm!).toBeLessThanOrEqual(1205);
      expect(s.pi!.tempC!).toBeGreaterThanOrEqual(51);
      expect(s.pi!.tempC!).toBeLessThanOrEqual(54);
      expect(s.net!.latencyMs).toBeGreaterThanOrEqual(31);
      expect(s.net!.latencyMs).toBeLessThanOrEqual(47);
    }
  });
  it('slides the sparkline window (always 24 values)', () => {
    let s = base;
    for (let i = 0; i < 40; i++) s = simStep(s, NOW, rng(0.3));
    expect(s.co2Spark).toHaveLength(24);
    expect(s.co2Spark.at(-1)).toBe(s.env!.co2Ppm);
  });
  it('baseline constants match the template text', () => {
    expect(BASELINE).toMatchObject({ tempC: 28.4, humidity: 72, co2Ppm: 1180, piTempC: 52, latencyMs: 38 });
  });
});
