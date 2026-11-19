import { describe, expect, it } from 'vitest';
import { FpsMeter, nextQuality, parseQuality, parseQualityQuery, resolveQuality } from '../src/quality';

describe('parse', () => {
  it('reads ?quality', () => {
    expect(parseQualityQuery('?quality=lite')).toBe('lite');
    expect(parseQualityQuery('?x=1&quality=css')).toBe('css');
    expect(parseQualityQuery('?quality=ultra')).toBeNull();
    expect(parseQualityQuery('')).toBeNull();
    expect(parseQuality('full')).toBe('full');
    expect(parseQuality(5)).toBeNull();
  });
});

describe('resolveQuality', () => {
  const base = { query: null, stored: null, reducedMotion: false, probeWebGL: () => true } as const;
  it('defaults to full when WebGL exists, and allows auto downgrade', () => {
    expect(resolveQuality(base)).toEqual({ quality: 'full', auto: true });
  });
  it('falls back to css without WebGL', () => {
    expect(resolveQuality({ ...base, probeWebGL: () => false })).toEqual({ quality: 'css', auto: true });
  });
  it('prefers-reduced-motion means css, without probing WebGL at all', () => {
    let probed = false;
    const r = resolveQuality({ ...base, reducedMotion: true, probeWebGL: () => ((probed = true), true) });
    expect(r).toEqual({ quality: 'css', auto: false });
    expect(probed).toBe(false);
  });
  it('?quality beats storage beats everything; both disable auto downgrade', () => {
    expect(resolveQuality({ ...base, query: 'lite', stored: 'css', reducedMotion: true })).toEqual({ quality: 'lite', auto: false });
    expect(resolveQuality({ ...base, stored: 'css' })).toEqual({ quality: 'css', auto: false });
  });
  it('?quality=css never probes WebGL', () => {
    let probed = false;
    resolveQuality({ ...base, query: 'css', probeWebGL: () => ((probed = true), true) });
    expect(probed).toBe(false);
  });
});

describe('nextQuality (auto downgrade)', () => {
  it('full < 30 fps -> lite', () => {
    expect(nextQuality('full', 29.9)).toBe('lite');
    expect(nextQuality('full', 30)).toBeNull();
    expect(nextQuality('full', 60)).toBeNull();
  });
  it('lite is the floor: a slow frame rate never drops to css', () => {
    expect(nextQuality('lite', 5)).toBeNull();
    expect(nextQuality('lite', 29)).toBeNull();
  });
  it('css never goes lower', () => expect(nextQuality('css', 1)).toBeNull());
});

describe('FpsMeter with simulated frame times', () => {
  const run = (fps: number, seconds: number, meter = new FpsMeter()) => {
    const results: number[] = [];
    const step = 1000 / fps;
    for (let t = 0; t <= seconds * 1000; t += step) {
      const r = meter.tick(t);
      if (r !== null) results.push(r);
    }
    return results;
  };
  it('reports ~fps after warm-up + a 3 s window', () => {
    const r = run(60, 6);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]!).toBeGreaterThan(55);
    expect(r[0]!).toBeLessThan(65);
  });
  it('reports nothing before warm-up + window have passed', () => {
    expect(run(60, 3.9)).toEqual([]);
  });
  it('slow display is measured as slow and feeds the downgrade decision', () => {
    const r = run(20, 6);
    expect(r[0]!).toBeGreaterThan(18);
    expect(r[0]!).toBeLessThan(22);
    expect(nextQuality('full', r[0]!)).toBe('lite');
    expect(nextQuality('lite', 20)).toBeNull(); // lite is the floor
  });
  it('a display slower than one frame per second is still measured, as very slow', () => {
    const r = run(0.6, 40);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]!).toBeLessThan(1);
    expect(nextQuality('full', r[0]!)).toBe('lite');
  });
  it('reset() restarts the measurement (used when the tab becomes visible again)', () => {
    const m = new FpsMeter();
    for (let t = 0; t < 2500; t += 16) m.tick(t);
    m.reset();
    const after: number[] = [];
    for (let t = 60_000; t < 66_000; t += 16.7) {
      const r = m.tick(t);
      if (r !== null) after.push(r);
    }
    expect(after[0]!).toBeGreaterThan(55);
  });
});
