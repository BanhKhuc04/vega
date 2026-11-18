import { describe, expect, it } from 'vitest';
import { parseLiteQuery, resolveLite } from '../src/lib/lite';

describe('lite mode resolution (D5)', () => {
  it('parses ?lite', () => {
    expect(parseLiteQuery('?lite=1')).toBe('on');
    expect(parseLiteQuery('?x=1&lite=0')).toBe('off');
    expect(parseLiteQuery('')).toBeNull();
    expect(parseLiteQuery('?lite=maybe')).toBeNull();
  });
  const base = { query: null, stored: null, reducedMotion: false, lowFps: false } as const;
  it('is off by default', () => expect(resolveLite(base)).toBe(false));
  it('turns on for reduced motion and for low FPS', () => {
    expect(resolveLite({ ...base, reducedMotion: true })).toBe(true);
    expect(resolveLite({ ...base, lowFps: true })).toBe(true);
  });
  it('?lite=1 beats everything; ?lite=0 disables auto', () => {
    expect(resolveLite({ ...base, query: 'on', stored: 'off' })).toBe(true);
    expect(resolveLite({ ...base, query: 'off', reducedMotion: true, lowFps: true })).toBe(false);
  });
  it('a stored manual choice beats auto detection', () => {
    expect(resolveLite({ ...base, stored: 'off', reducedMotion: true })).toBe(false);
    expect(resolveLite({ ...base, stored: 'on' })).toBe(true);
  });
});
