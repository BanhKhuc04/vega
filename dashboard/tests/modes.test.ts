import { describe, expect, it } from 'vitest';
import { parseHash, reduceMode } from '../src/lib/modes';

describe('reduceMode', () => {
  it('goto switches to any mode', () => {
    expect(reduceMode('idle', { type: 'goto', mode: 'history' })).toBe('history');
    expect(reduceMode('history', { type: 'goto', mode: 'focus' })).toBe('focus');
  });
  it('expand opens focus only from research', () => {
    expect(reduceMode('research', { type: 'expand' })).toBe('focus');
    expect(reduceMode('idle', { type: 'expand' })).toBe('idle');
    expect(reduceMode('history', { type: 'expand' })).toBe('history');
  });
  it('close returns focus to research and is a no-op elsewhere', () => {
    expect(reduceMode('focus', { type: 'close' })).toBe('research');
    expect(reduceMode('idle', { type: 'close' })).toBe('idle');
  });
  it('submit and openHistoryItem always land on research', () => {
    for (const m of ['idle', 'research', 'focus', 'history'] as const) {
      expect(reduceMode(m, { type: 'submit' })).toBe('research');
      expect(reduceMode(m, { type: 'openHistoryItem' })).toBe('research');
    }
  });
});

describe('parseHash', () => {
  it('recognises modes and the core route', () => {
    expect(parseHash('#/research')).toEqual({ view: 'main', mode: 'research' });
    expect(parseHash('#/core')).toEqual({ view: 'core' });
    expect(parseHash('#/core?x=1')).toEqual({ view: 'core' });
  });
  it('ignores unknown hashes', () => {
    expect(parseHash('')).toEqual({ view: 'main', mode: null });
    expect(parseHash('#/nope')).toEqual({ view: 'main', mode: null });
  });
});
