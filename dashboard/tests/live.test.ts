// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveBinder, fmtAgo, fmtIn, liveText } from '../src/ui/live';
import { CONN_LABEL, nextTier, renderConn, renderQuality } from '../src/ui/chrome';
import { emptySnapshot, sampleSnapshot } from '../src/data/sample';
import type { Snapshot } from '../src/data/types';
import { loadTemplate } from './dom';

const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();
const $ = (k: string) => document.querySelector<HTMLElement>(`[data-live="${k}"]`)!;

describe('formatters', () => {
  it('fmtAgo', () => {
    expect(fmtAgo(10_000)).toBe('just now');
    expect(fmtAgo(4 * 60_000)).toBe('4 min ago');
    expect(fmtAgo(3 * 3600_000)).toBe('3 h ago');
    expect(fmtAgo(50 * 3600_000)).toBe('2 d ago');
  });
  it('fmtIn', () => {
    expect(fmtIn(-5)).toBe('now');
    expect(fmtIn(20 * 60_000)).toBe('in 20 min');
    expect(fmtIn((3 * 60 + 6) * 60_000)).toBe('in 3 h 06 min');
  });
});

describe('liveText', () => {
  it('SIM sample snapshot reproduces the template wording and is labelled sample', () => {
    const t = liveText(sampleSnapshot(NOW), NOW);
    expect(t).toMatchObject({
      roomName: 'Bedroom', temp: '28.4', hum: '72', co2: '1,180', co2Warn: true, co2note: 'above threshold · open a window',
      presence: 'Occupied', meshOn: '6', meshTotal: '6', meshKinds: 'esp8266 ×5 · esp32-s3 ×1',
      ci: '1 failed build', ciBad: true, ciSub: 'firmware-esp · 4 min ago', next: '16:30 lab report', nextSub: 'computer networks',
      piText: 'PI · 52°C', coText: 'CORE TEMP · 52°C', meshText: 'MESH · 6/6 ONLINE', latText: 'LATENCY · 38 MS', sample: true,
    });
  });
  it('an empty MQTT snapshot changes nothing and stays labelled sample', () => {
    const t = liveText(emptySnapshot('mqtt'), NOW);
    expect(t.sample).toBe(true);
    expect(t.temp).toBeUndefined();
    expect(t.meshOn).toBeUndefined();
  });
  it('a complete real snapshot is not labelled sample', () => {
    const s: Snapshot = { ...sampleSnapshot(NOW), isSample: false, sourceKind: 'mqtt', conn: 'live' };
    expect(liveText(s, NOW).sample).toBe(false);
  });
  it('a device going offline lowers the mesh count at once', () => {
    const s = sampleSnapshot(NOW);
    const off = { ...s, devices: s.devices.map((d, i) => (i === 0 ? { ...d, online: false } : d)) };
    expect(liveText(off, NOW)).toMatchObject({ meshOn: '5', meshTotal: '6', meshText: 'MESH · 5/6 ONLINE' });
  });
  it('CI news older than 5 minutes is marked stale', () => {
    expect(liveText({ ...sampleSnapshot(NOW), ci: { repo: 'me/vega', failed: 0, ts: NOW - 60_000 } }, NOW).ciSub).toBe('me/vega · 1 min ago');
    expect(liveText({ ...sampleSnapshot(NOW), ci: { repo: 'me/vega', failed: 0, ts: NOW - 6 * 60_000 } }, NOW).ciSub).toBe('me/vega · 6 min ago · stale');
  });
  it('green CI, below threshold, away', () => {
    const s = { ...sampleSnapshot(NOW), ci: { repo: 'x', failed: 0, ts: NOW }, presence: false };
    s.env = { ...s.env!, co2Ppm: 640 };
    expect(liveText(s, NOW)).toMatchObject({ ci: 'all builds passing', ciBad: false, co2Warn: false, co2note: 'within range', presence: 'Away' });
  });
  it('plural failures and missing readings', () => {
    const s = { ...sampleSnapshot(NOW), ci: { repo: 'x', failed: 3, ts: NOW } };
    s.env = { ...s.env!, tempC: null };
    expect(liveText(s, NOW)).toMatchObject({ ci: '3 failed builds', temp: '—' });
  });
  it('AI budget: used and left today; at the limit it says local only; a stale day counts as nothing spent', () => {
    const today = sampleSnapshot(NOW).ai!.day;
    const ai = (o: Partial<NonNullable<Snapshot['ai']>>): Snapshot => ({ ...sampleSnapshot(NOW), ai: { day: today, spentUsd: 0.0012, budgetUsd: 0.05, calls: 4, ...o } });
    expect(liveText(ai({}), NOW)).toMatchObject({ ai: '$0.0012 used', aiSub: '$0.0488 left of $0.05 · 4 calls', aiBad: false });
    expect(liveText(ai({ spentUsd: 0.0503, calls: 1 }), NOW)).toMatchObject({ ai: '$0.0503 used', aiSub: 'daily limit $0.05 reached · local only', aiBad: true });
    expect(liveText(ai({ day: '2020-01-01', spentUsd: 0.05 }), NOW)).toMatchObject({ ai: '$0.00 used', aiSub: '$0.05 left of $0.05 · 0 calls', aiBad: false });
    expect(liveText(emptySnapshot('mqtt'), NOW).ai).toBeUndefined(); // no brain yet: the template text stays
  });
  it('next event without detail shows the countdown', () => {
    const s = { ...sampleSnapshot(NOW), next: { title: 'call', detail: null, at: NOW + 20 * 60_000 } };
    expect(liveText(s, NOW)).toMatchObject({ next: '12:20 call', nextSub: 'in 20 min' });
  });
});

describe('LiveBinder', () => {
  beforeEach(() => loadTemplate());
  const mk = (mode = 'idle') => {
    const hud = { zap: vi.fn((el: Element, t: string) => (el.textContent = t)), getMode: () => mode, barHtml: (v: number[]) => v.map((x) => `<i>${x}</i>`).join('') };
    return { hud, binder: new LiveBinder(hud) };
  };

  it('first paint writes directly, later changes zap while the screen is visible', () => {
    const { hud, binder } = mk();
    const s = sampleSnapshot(NOW);
    binder.render(s, NOW);
    expect(hud.zap).not.toHaveBeenCalled();
    expect($('temp').textContent).toBe('28.4');
    expect($('temp').dataset.count).toBe('28.4');
    expect($('co2').dataset.count).toBe('1180'); // countUp target for the intro
    binder.render({ ...s, env: { ...s.env!, tempC: 29.1 } }, NOW);
    expect(hud.zap).toHaveBeenCalledWith($('temp'), '29.1');
    hud.zap.mockClear();
    binder.render({ ...s, env: { ...s.env!, tempC: 29.1 } }, NOW);
    expect(hud.zap).not.toHaveBeenCalled(); // unchanged
  });

  it('writes silently when Idle is not on screen', () => {
    const { hud, binder } = mk('research');
    const s = sampleSnapshot(NOW);
    binder.render(s, NOW);
    binder.render({ ...s, env: { ...s.env!, tempC: 20.5 } }, NOW);
    expect(hud.zap).not.toHaveBeenCalled();
    expect($('temp').textContent).toBe('20.5');
  });

  it('toggles warn / bad classes, sparkline, sample tag and callouts', () => {
    const { binder } = mk();
    const s = sampleSnapshot(NOW);
    binder.render(s, NOW);
    expect($('co2row').classList.contains('warn')).toBe(true);
    expect($('cirow').classList.contains('bad')).toBe(true);
    expect(document.querySelector<HTMLElement>('#sampleTag')!.hidden).toBe(false);
    expect(document.querySelectorAll('#spark i')).toHaveLength(24);
    expect($('meshText').textContent).toBe('MESH · 6/6 ONLINE');
    const real: Snapshot = { ...s, isSample: false, env: { ...s.env!, co2Ppm: 500 }, ci: { repo: 'x', failed: 0, ts: NOW } };
    binder.render(real, NOW);
    expect($('co2row').classList.contains('warn')).toBe(false);
    expect($('cirow').classList.contains('bad')).toBe(false);
    expect(document.querySelector<HTMLElement>('#sampleTag')!.hidden).toBe(true);
  });

  it('an empty snapshot leaves the template values alone', () => {
    const { binder } = mk();
    const before = document.body.innerHTML;
    binder.render(emptySnapshot('mqtt'), NOW);
    const after = document.body.innerHTML.replaceAll(' hidden=""', '');
    expect(after).toBe(before.replaceAll(' hidden=""', ''));
    expect(document.querySelector<HTMLElement>('#sampleTag')!.hidden).toBe(false);
  });
});

describe('header chrome', () => {
  beforeEach(() => loadTemplate());
  it('connection chip for each state', () => {
    for (const conn of ['live', 'reconnecting', 'offline', 'sim'] as const) {
      renderConn({ conn });
      expect(document.querySelector('#connTxt')?.textContent).toBe(CONN_LABEL[conn]);
      expect((document.querySelector('#conn') as HTMLElement).dataset.state).toBe(conn);
    }
    expect(CONN_LABEL).toEqual({ live: 'LIVE', reconnecting: 'RECONNECTING', offline: 'OFFLINE', sim: 'SIM' });
  });
  it('quality button shows the running tier and says when it was lowered automatically', () => {
    renderQuality('css', true);
    expect(document.querySelector('#qTxt')?.textContent).toBe('CSS');
    expect(document.querySelector('#qBtn')?.getAttribute('aria-label')).toContain('set automatically');
    renderQuality('full', false);
    expect(document.querySelector('#qBtn')?.getAttribute('aria-label')).toBe('Render quality: full. Activate to change');
  });
  it('cycles full -> lite -> css -> full', () => {
    expect(['full', 'lite', 'css'].map((q) => nextTier(q as 'full'))).toEqual(['lite', 'full', 'full']); // the button toggles full <-> lite
  });
});
