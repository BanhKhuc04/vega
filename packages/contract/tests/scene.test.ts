import { describe, expect, it } from 'vitest';
import { SCENES, parseScene, sceneDataSchemas, sceneExpiresAt } from '../src';

describe('scene envelope', () => {
  it('accepts a bare scene name for all 11 templates (all data optional)', () => {
    expect(SCENES).toHaveLength(11);
    for (const scene of SCENES) expect(parseScene({ v: 1, scene }).ok, scene).toBe(true);
  });
  it('accepts level, orb, status, ttl, ts, id', () => {
    const r = parseScene({ v: 1, scene: 'research', level: 'high', orb: 'think', status: 'Researching', ttl: 600, ts: '2026-11-18T09:30:00Z', id: 'x1', data: {} });
    expect(r.ok).toBe(true);
  });
  it('parses from a JSON string', () => {
    expect(parseScene('{"v":1,"scene":"idle"}').ok).toBe(true);
  });
  it.each([
    ['invalid JSON', '{nope'],
    ['empty string', ''],
    ['not an object', '[]'],
    ['null', 'null'],
    ['no version', { scene: 'idle' }],
    ['wrong version', { v: 7, scene: 'idle' }],
    ['unknown scene', { v: 1, scene: 'disco' }],
    ['missing scene', { v: 1 }],
    ['bad level', { v: 1, scene: 'idle', level: 'extreme' }],
    ['ttl zero', { v: 1, scene: 'idle', ttl: 0 }],
    ['ttl fractional', { v: 1, scene: 'idle', ttl: 1.5 }],
    ['ttl string', { v: 1, scene: 'idle', ttl: '600' }],
    ['bad ts', { v: 1, scene: 'idle', ts: 'now' }],
    ['data wrong type', { v: 1, scene: 'research', data: 'x' }],
  ])('rejects %s', (_n, v) => {
    const r = parseScene(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
  it('reports the failing path', () => {
    const r = parseScene({ v: 1, scene: 'research', data: { step: { current: 'three', total: 5, label: 'x' } } });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('data.step.current');
  });
});

describe('per-scene data schemas: valid / missing / wrong', () => {
  const valid: Record<string, unknown> = {
    idle: { caption: 'Standing by' },
    listen: { transcript: 'turn off the light', hint: 'Listening' },
    think: { chips: [{ label: 'Parse intent', state: 'done' }, { label: 'Plan', state: 'run' }], plan: '→ light.off()' },
    research: {
      title: 'CO₂ sensors',
      step: { current: 3, total: 5, label: 'reading sources' },
      stat: { sources: 12, text: 'datasheets', ref: 'vg-1', progress: 0.5 },
      chart: { values: [1, 2, 3], thresholdPpm: 1000, maxPpm: 1500, summary: 's', footnote: 'f' },
      steps: [{ label: 'a', state: 'done' }],
      source: { title: 't', caption: 'c' },
      compare: { title: 'A vs B', columns: ['k', 'a', 'b'], rows: [{ label: 'r', cells: [{ text: 'x', tone: 'ok' }, { text: 'y' }] }] },
      note: { text: 'n', refs: '[1]' },
      log: [{ tag: 'agent', msg: 'm' }],
    },
    locate: { title: 'Locate', status: 'gps', target: { name: 'n', distanceKm: 2.4, detail: 'd', coord: 'c' }, route: { steps: ['a', 'b'] } },
    vision: { camera: 'CAM-02' },
    briefing: {
      kicker: 'k', title: 't', summary: 's',
      agenda: [{ time: '09:00', title: 'lab', hot: true }], inbox: [{ from: 'f', subject: 's' }], room: 'r',
      builds: { passing: 2, failing: 1, repo: 'x' },
    },
    focus: { kicker: 'k', minutes: 25, hint: 'h' },
    alert: { title: 't', ref: 'r', error: 'e', note: 'n' },
    success: { title: 't', ref: 'r', checks: ['a'] },
    sleep: { title: 't', lightsOffSeconds: 30, alarm: '07:00', dnd: true },
  };
  const wrong: Record<string, unknown> = {
    idle: { caption: 5 },
    listen: { transcript: ['x'] },
    think: { chips: [{ label: 'x', state: 'maybe' }] },
    research: { stat: { sources: 'twelve' } },
    locate: { target: { distanceKm: 'far' } },
    vision: { camera: 5 },
    briefing: { agenda: [{ time: '09:00' }] },
    focus: { minutes: 0 },
    alert: { error: 5 },
    success: { checks: 'all' },
    sleep: { lightsOffSeconds: -1 },
  };
  for (const scene of SCENES) {
    it(`${scene}: valid full data`, () => expect(sceneDataSchemas[scene].safeParse(valid[scene]).success).toBe(true));
    it(`${scene}: missing data is fine (defaults apply)`, () => expect(sceneDataSchemas[scene].safeParse({}).success).toBe(true));
    it(`${scene}: wrong type is rejected via the envelope`, () => expect(parseScene({ v: 1, scene, data: wrong[scene] }).ok).toBe(false));
    it(`${scene}: valid data accepted via the envelope`, () => expect(parseScene({ v: 1, scene, data: valid[scene] }).ok).toBe(true));
  }
  it('rejects empty lists and oversize lists', () => {
    expect(parseScene({ v: 1, scene: 'research', data: { steps: [] } }).ok).toBe(false);
    expect(parseScene({ v: 1, scene: 'research', data: { log: Array(31).fill({ tag: 'a', msg: 'b' }) } }).ok).toBe(false);
  });
  it('ignores unknown fields', () => {
    const r = parseScene({ v: 1, scene: 'idle', future: true, data: { caption: 'x', extra: 1 } });
    expect(r.ok).toBe(true);
  });
});

describe('sceneExpiresAt', () => {
  const base = parseScene({ v: 1, scene: 'alert', ttl: 30, ts: '2026-11-18T09:00:00Z' });
  it('counts ttl from ts', () => {
    if (!base.ok) throw new Error('bad fixture');
    expect(sceneExpiresAt(base.scene, 0)).toBe(Date.parse('2026-11-18T09:00:30Z'));
  });
  it('counts ttl from arrival when ts is missing', () => {
    const r = parseScene({ v: 1, scene: 'alert', ttl: 30 });
    if (!r.ok) throw new Error('bad fixture');
    expect(sceneExpiresAt(r.scene, 1000)).toBe(31_000);
  });
  it('never expires without ttl', () => {
    const r = parseScene({ v: 1, scene: 'idle' });
    if (!r.ok) throw new Error('bad fixture');
    expect(sceneExpiresAt(r.scene, 1000)).toBeNull();
  });
});
