import { describe, expect, it } from 'vitest';
import { parseScene } from '@vega/contract';
import { HealthWatch, ago } from '../src/health';

const MIN = 60_000;
const T0 = Date.parse('2026-11-21T10:00:00Z');

function watch(opts: { disk?: number | null; backupMaxH?: number } = {}) {
  let now = T0;
  const alerts: { title: string; label: string }[] = [];
  const logs: string[] = [];
  const disk = { pct: opts.disk === undefined ? 50 : opts.disk };
  const w = new HealthWatch({
    backupMaxH: opts.backupMaxH ?? 36,
    notify: (s, label) => {
      const r = parseScene({ v: 1, ...s });
      if (!r.ok) throw new Error(r.error);
      alerts.push({ title: (s.data as { title: string }).title, label });
    },
    log: (m) => logs.push(m),
    diskFreePct: () => disk.pct,
    now: () => now,
  });
  const at = (iso: number) => new Date(iso).toISOString();
  const services = (restarts = 0, health = 'healthy', state = 'running') =>
    JSON.stringify({ v: 1, ts: at(now), services: [{ name: 'vega-brain', state, health, restarts }, { name: 'mosquitto', state: 'running', health: 'healthy', restarts: 0 }] });
  const backup = (ok = true, ts = now) => JSON.stringify({ v: 1, ts: at(ts), ok, offsite: true, bytes: 1234 });
  return { w, alerts, logs, disk, services, backup, tick: (ms: number) => void (now += ms), now: () => now };
}

describe('HealthWatch', () => {
  it('all fine: no alert, a short /status line', () => {
    const h = watch();
    h.w.onHealth(h.services());
    h.w.onBackup(h.backup());
    h.w.check();
    expect(h.alerts).toEqual([]);
    expect(h.w.summary()).toBe('services 2/2 ok · disk 50% free · backup 0 min ago');
  });

  it('an unhealthy container: one Alert, not repeated, logged when it clears', () => {
    const h = watch();
    h.w.onBackup(h.backup());
    h.w.onHealth(h.services(0, 'unhealthy'));
    h.w.check();
    h.w.check();
    expect(h.alerts.map((a) => a.title)).toEqual(['vega-brain down']);
    h.w.onHealth(h.services());
    h.w.check();
    expect(h.logs.at(-1)).toBe('[health] cleared: vega-brain down');
    expect(h.w.problems()).toEqual([]);
  });

  it('3 restarts within 10 minutes is a problem, spread over an hour is not', () => {
    const h = watch();
    h.w.onBackup(h.backup());
    h.w.onHealth(h.services(5));
    h.tick(4 * MIN);
    h.w.onHealth(h.services(8));
    expect(h.w.problems().map((p) => p.key)).toEqual(['restart-vega-brain']);
    const slow = watch();
    slow.w.onBackup(slow.backup());
    for (let i = 0; i <= 6; i++) {
      slow.w.onHealth(slow.services(i));
      slow.tick(11 * MIN);
    }
    slow.w.onHealth(slow.services(7));
    expect(slow.w.problems()).toEqual([]);
  });

  it('silence from health.sh for 5 minutes is reported', () => {
    const h = watch();
    h.w.onBackup(h.backup());
    h.w.onHealth(h.services());
    h.tick(6 * MIN);
    expect(h.w.problems().map((p) => p.key)).toEqual(['health-stale']);
  });

  it('disk under 10% free', () => {
    const h = watch({ disk: 8.5 });
    h.w.onHealth(h.services());
    h.w.onBackup(h.backup());
    expect(h.w.problems().map((p) => p.key)).toEqual(['disk']);
  });

  it('80 °C for 2 minutes, not a short peak', () => {
    const h = watch();
    h.w.onHealth(h.services());
    h.w.onBackup(h.backup());
    h.w.onTemp(81);
    h.tick(MIN);
    h.w.onTemp(82);
    expect(h.w.problems()).toEqual([]);
    h.tick(MIN);
    h.w.onHealth(h.services());
    expect(h.w.problems().map((p) => p.key)).toEqual(['hot']);
    h.w.onTemp(70);
    expect(h.w.problems()).toEqual([]);
  });

  it('backup: failed, too old, or never once the window has passed', () => {
    const h = watch();
    h.w.onHealth(h.services());
    h.w.onBackup(h.backup(false));
    expect(h.w.problems()[0]).toMatchObject({ key: 'backup', title: 'backup failed' });
    h.w.onBackup(h.backup(true, h.now() - 37 * 60 * MIN));
    expect(h.w.problems()[0]).toMatchObject({ key: 'backup', title: 'backup too old' });
    const none = watch({ backupMaxH: 1 });
    none.tick(61 * MIN);
    none.w.onHealth(none.services());
    expect(none.w.problems().map((p) => p.title)).toEqual(['no backup']);
  });

  it('ignores payloads outside the contract', () => {
    const h = watch();
    expect(h.w.onHealth('{"v":1,"services":"x"}')).toBe(false);
    expect(h.w.onBackup('not json')).toBe(false);
  });

  it('ago', () => {
    expect([ago(0), ago(59 * MIN), ago(3 * 60 * MIN), ago(72 * 60 * MIN)]).toEqual(['0 min', '59 min', '3 h', '3 d']);
  });
});
