import { describe, expect, it, vi } from 'vitest';
import { MockSource } from '../src/lib/mock';
import { SAMPLE_CO2 } from '../src/lib/sample';
import { barModel, hoursOver, peak, thresholdPct } from '../src/lib/co2';

const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);

describe('MockSource', () => {
  it('starts with labelled sample data matching the design', () => {
    const s = new MockSource({ now: () => NOW }).getSnapshot();
    expect(s.isMock).toBe(true);
    expect(s.sourceKind).toBe('mock');
    expect(s.connection).toBe('connected');
    expect(s.env).toMatchObject({ roomName: 'Phòng ngủ', tempC: 28.4, humidity: 72, co2Ppm: 1180 });
    expect(s.devices).toHaveLength(6);
    expect(s.devices.filter((d) => d.kind === 'esp8266')).toHaveLength(5);
    expect(s.devices.filter((d) => d.kind === 'esp32-s3')).toHaveLength(1);
    expect(s.ci).toMatchObject({ repo: 'firmware-esp', failed: 1 });
    expect(s.next?.title).toBe('nộp lab');
    expect(s.next!.at - NOW).toBe((3 * 60 + 6) * 60_000);
    expect(s.co2?.values).toEqual(SAMPLE_CO2);
    expect(s.history.length).toBeGreaterThan(0);
  });

  it('notifies subscribers immediately and on change, and supports unsubscribe', () => {
    const src = new MockSource({ now: () => NOW });
    const fn = vi.fn();
    const off = src.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    src.sendCommand('tắt đèn');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    src.sendCommand('khác');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sendCommand records history, creates a session and returns the entry', () => {
    const src = new MockSource({ now: () => NOW });
    const before = src.getSnapshot().history.length;
    const e = src.sendCommand('  nghiên cứu cảm biến CO₂  ');
    expect(e).not.toBeNull();
    expect(e!.text).toBe('nghiên cứu cảm biến CO₂');
    expect(e!.session?.title).toContain('nghiên cứu cảm biến CO₂');
    const s = src.getSnapshot();
    expect(s.history).toHaveLength(before + 1);
    expect(s.history[0]).toBe(e);
    expect(s.research?.id).toBe(e!.id);
  });

  it('ignores empty commands and gives unique ids', () => {
    const src = new MockSource({ now: () => NOW });
    expect(src.sendCommand('   ')).toBeNull();
    const a = src.sendCommand('a')!;
    const b = src.sendCommand('b')!;
    expect(a.id).not.toBe(b.id);
  });

  it('start/stop are idempotent', () => {
    const src = new MockSource({ now: () => NOW });
    src.start();
    src.start();
    src.stop();
    src.stop();
    expect(src.getSnapshot().isMock).toBe(true);
  });
});

describe('CO₂ chart model (design data)', () => {
  const series = new MockSource({ now: () => NOW }).getSnapshot().co2!;
  it('puts the 1000 ppm threshold at 66.67% of the 1500 scale', () => {
    expect(thresholdPct(series)).toBeCloseTo(66.67, 1);
  });
  it('peaks at 1420 ppm at 05:00', () => {
    expect(peak(series)).toEqual({ hour: 5, ppm: 1420 });
  });
  it('marks bars above the threshold only (980 is not over, 1080 is)', () => {
    const bars = barModel(series);
    expect(bars).toHaveLength(24);
    expect(bars[0]!.over).toBe(false);
    expect(bars[1]!.over).toBe(true);
    expect(bars[7]!.over).toBe(true);
    expect(bars[8]!.over).toBe(false);
    expect(hoursOver(series)).toBe(7);
    expect(bars[5]!.heightPct).toBeCloseTo((1420 / 1500) * 100, 5);
  });
});
