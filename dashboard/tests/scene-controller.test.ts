// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseScene } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { SceneController } from '../src/scene/controller';
import { loadTemplate } from './dom';

const scene = (o: Record<string, unknown>): SceneMessage => {
  const r = parseScene({ v: 1, ...o });
  if (!r.ok) throw new Error(r.error);
  return r.scene;
};

function setup(startMs = Date.UTC(2026, 10, 18, 9, 0, 0)) {
  let mode = 'idle';
  const calls: string[] = [];
  const hud = {
    setMode: vi.fn((m: string, force?: boolean) => {
      calls.push(`mode:${m}${force ? '!' : ''}`);
      mode = m;
    }),
    getMode: () => mode,
    setLevel: vi.fn((l: string) => calls.push(`level:${l}`)),
    setStatusOverride: vi.fn((t: string | null) => calls.push(`status:${t}`)),
    setLog: vi.fn(),
  };
  let now = startMs;
  const ctl = new SceneController({ hud, now: () => now });
  return { ctl, hud, calls, setNow: (n: number) => (now = n), setMode: (m: string) => (mode = m), start: startMs };
}

beforeEach(() => {
  loadTemplate();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('SceneController', () => {
  it('renders data, then switches mode with force, status override and level', () => {
    const { ctl, hud, calls } = setup();
    expect(ctl.handle(scene({ scene: 'research', level: 'high', status: 'Researching', data: { title: 'Hello' } }))).toBe(true);
    expect(document.querySelector('#rtitle')?.textContent).toBe('Hello');
    expect(calls).toEqual(['status:Researching', 'mode:research!', 'status:null', 'level:high']);
    expect(hud.setMode).toHaveBeenCalledWith('research', true);
  });

  it('missing optional fields: no status, no level', () => {
    const { ctl, calls } = setup();
    ctl.handle(scene({ scene: 'success' }));
    expect(calls).toEqual(['status:null', 'mode:success!', 'status:null']);
  });

  it('ttl: goes back to idle when it runs out', () => {
    const { ctl, hud } = setup();
    ctl.handle(scene({ scene: 'alert', ttl: 30 }));
    vi.advanceTimersByTime(29_000);
    expect(hud.setMode).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_500);
    expect(hud.setMode).toHaveBeenLastCalledWith('idle');
  });

  it('ttl is counted from ts when present (retained message after a reconnect)', () => {
    const { ctl, hud, start } = setup();
    const ts = new Date(start - 20_000).toISOString();
    ctl.handle(scene({ scene: 'alert', ttl: 30, ts }));
    vi.advanceTimersByTime(9_000);
    expect(hud.setMode).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_500);
    expect(hud.setMode).toHaveBeenLastCalledWith('idle');
  });

  it('a scene that already expired is ignored', () => {
    const { ctl, hud, start } = setup();
    const ts = new Date(start - 120_000).toISOString();
    expect(ctl.handle(scene({ scene: 'alert', ttl: 30, ts }))).toBe(false);
    expect(hud.setMode).not.toHaveBeenCalled();
  });

  it('no ttl: stays up', () => {
    const { ctl, hud } = setup();
    ctl.handle(scene({ scene: 'focus' }));
    vi.advanceTimersByTime(10 * 3600_000);
    expect(hud.setMode).toHaveBeenCalledTimes(1);
  });

  it('a newer scene cancels the previous ttl', () => {
    const { ctl, hud } = setup();
    ctl.handle(scene({ scene: 'alert', ttl: 10 }));
    ctl.handle(scene({ scene: 'success' }));
    vi.advanceTimersByTime(60_000);
    expect(hud.setMode).toHaveBeenCalledTimes(2);
    expect(hud.setMode).not.toHaveBeenCalledWith('idle');
  });

  it('does not yank the viewer back if they already left the scene by hand', () => {
    const { ctl, hud, setMode } = setup();
    ctl.handle(scene({ scene: 'alert', ttl: 5 }));
    setMode('briefing');
    vi.advanceTimersByTime(6000);
    expect(hud.setMode).toHaveBeenCalledTimes(1);
  });

  it('an identical redelivery is ignored, changed data is applied again', () => {
    const { ctl, hud } = setup();
    const a = scene({ scene: 'research', data: { title: 'A' } });
    expect(ctl.handle(a)).toBe(true);
    expect(ctl.handle(scene({ scene: 'research', data: { title: 'A' } }))).toBe(false);
    expect(ctl.handle(scene({ scene: 'research', data: { title: 'B' } }))).toBe(true);
    expect(hud.setMode).toHaveBeenCalledTimes(2);
  });

  it('after the ttl, the same scene can be shown again', () => {
    const { ctl, hud } = setup();
    ctl.handle(scene({ scene: 'alert', ttl: 5 }));
    vi.advanceTimersByTime(6000);
    expect(ctl.handle(scene({ scene: 'alert', ttl: 5 }))).toBe(true);
    expect(hud.setMode).toHaveBeenCalledWith('alert', true);
  });

  it('dispose cancels the timer', () => {
    const { ctl, hud } = setup();
    ctl.handle(scene({ scene: 'alert', ttl: 5 }));
    ctl.dispose();
    vi.advanceTimersByTime(10_000);
    expect(hud.setMode).toHaveBeenCalledTimes(1);
  });
});
