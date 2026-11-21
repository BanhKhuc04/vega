import { describe, expect, it } from 'vitest';
import { parseScene } from '@vega/contract';
import { Locator, distanceM } from '../src/locate';
import { Store } from '../src/store';
import { makeAgent } from './harness';

const HOME = { lat: 21.0285, lon: 105.8542, radiusM: 150 };
const T0 = Date.parse('2026-11-21T10:00:00Z');
const fix = (lat: number, lon: number, tstMs: number, extra: Record<string, unknown> = {}) => JSON.stringify({ _type: 'location', lat, lon, acc: 12, tst: Math.floor(tstMs / 1000), ...extra });

function locator(store = new Store(':memory:'), home: typeof HOME | null = HOME) {
  let now = T0;
  const presence: boolean[] = [];
  const logs: string[] = [];
  const l = new Locator({ store, home, homeRegions: ['Nhà', 'Home'], presence: (h) => presence.push(h), log: (m) => logs.push(m), now: () => now });
  return { l, presence, logs, store, tick: (ms: number) => void (now += ms) };
}

describe('Locator', () => {
  it('distance', () => {
    expect(Math.round(distanceM(HOME, { lat: 21.0375, lon: 105.8542 }))).toBe(1001);
  });

  it('home inside the circle, away outside; presence only on a change', () => {
    const t = locator();
    t.l.onMessage('owntracks/vega/phone', fix(21.0286, 105.8543, T0));
    t.l.onMessage('owntracks/vega/phone', fix(21.0287, 105.8541, T0 + 60_000));
    t.l.onMessage('owntracks/vega/phone', fix(21.05, 105.86, T0 + 120_000));
    expect(t.presence).toEqual([true, false]);
    expect(t.logs).toEqual(['[locate] owner home', '[locate] owner away']);
  });

  it('a home region counts even outside the circle (folded: "nha" = "Nhà")', () => {
    const t = locator();
    t.l.onMessage('owntracks/vega/phone', fix(21.1, 105.9, T0, { inregions: ['nha'] }));
    expect(t.l.atHome).toBe(true);
  });

  it('keeps only the latest point, survives a restart, drops late older points and other message types', () => {
    const store = new Store(':memory:');
    const t = locator(store);
    t.l.onMessage('owntracks/vega/phone', fix(21.05, 105.86, T0 + 60_000));
    t.l.onMessage('owntracks/vega/phone', fix(21.0285, 105.8542, T0));
    t.l.onMessage('owntracks/vega/phone', JSON.stringify({ _type: 'transition', event: 'enter', tst: 1 }));
    t.l.onMessage('owntracks/vega/phone', '{broken');
    expect(store.lastLocation()).toMatchObject({ device: 'phone', lat: 21.05, lon: 105.86, accM: 12 });
    const again = locator(store);
    expect(again.l.atHome).toBe(false);
  });

  it('answer: a sentence without coordinates, and a valid Locate scene with them', () => {
    const t = locator();
    t.l.onMessage('owntracks/vega/phone', fix(21.0465, 105.8542, T0, { inregions: ['Công ty'] }));
    t.tick(3 * 60_000);
    const a = t.l.answer('vi');
    expect(a.text).toBe('Bạn đang cách nhà 2,0 km, ở Công ty (cập nhật 3 phút trước).');
    expect(t.l.answer('en').text).toBe('You are 2.0 km from home, at Công ty (updated 3 min ago).');
    expect(a.text).not.toMatch(/21\.0|105\.8/);
    const r = parseScene({ v: 1, ...a.scene });
    expect(r.ok).toBe(true);
    expect(a.scene!.data).toMatchObject({ target: { name: 'away', distanceKm: 2, lat: 21.0465, lon: 105.8542, accuracyM: 12, coord: '21.0465° N · 105.8542° E' } });
  });

  it('no point yet, no home set', () => {
    expect(locator().l.answer('en')).toEqual({ text: 'No location from the phone yet. Set up OwnTracks (docs/pi-setup.md).', scene: null });
    const t = locator(new Store(':memory:'), null);
    t.l.onMessage('owntracks/vega/phone', fix(21.05, 105.86, T0));
    expect(t.l.atHome).toBeNull();
    expect(t.presence).toEqual([]);
    expect(t.l.answer('en').text).toMatch(/^Phone located/);
  });
});

describe('"tôi đang ở đâu" end to end in the agent', () => {
  it('local command, no AI call, shows the Locate screen', async () => {
    const store = new Store(':memory:');
    const t = locator(store);
    t.l.onMessage('owntracks/vega/phone', fix(21.0286, 105.8543, Date.now() - 60_000));
    const a = makeAgent({ deps: { locator: t.l } });
    await a.agent.handle({ id: 'l1', text: 'tôi đang ở đâu', origin: 'owner' });
    expect(a.llm.calls).toBe(0);
    expect(a.results[0]!.text).toMatch(/^Bạn đang ở nhà/);
    expect(a.scenes.at(-1)!.scene).toBe('locate');
  });
});
