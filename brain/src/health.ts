/**
 * Health of the Pi (M8, brief 0013 B5–B6): containers (vega/system/health from infra/pi/health.sh), free disk, SoC
 * temperature, age of the last backup (vega/system/backup from infra/pi/backup.sh). Each problem raises one Alert when it
 * starts and is logged when it clears; `/status` and the Console list what is wrong now. The brain never touches Docker.
 */
import { statfsSync } from 'node:fs';
import { backupState, systemHealth, watchBeat } from '@vega/contract';
import type { BackupState, SystemHealth } from '@vega/contract';
import type { SceneOut } from './bus';

const MIN = 60_000;
const RESTART_WINDOW = 10 * MIN;
const RESTARTS_MAX = 3;
const HOT_C = 80;
const HOT_FOR = 2 * MIN;
const DISK_MIN_PCT = 10;
/** health.sh publishes every minute: silence this long means it (or its timer) stopped. */
const HEALTH_STALE = 5 * MIN;
/** The Pi 3 watchdog beats every minute (brief 0014 P4). */
const WATCH_STALE = 5 * MIN;

export interface Problem {
  key: string;
  title: string;
  detail: string;
}

export interface HealthDeps {
  backupMaxH: number;
  /** Shows the Alert (held during Focus). */
  notify(scene: SceneOut, label: string): void;
  log(msg: string): void;
  /** Free space of the disk that holds the database, 0–100; null when unknown. */
  diskFreePct(): number | null;
  /** The last failure of phone alerts (M10), null when fine or off. */
  phoneError?: () => string | null;
  now?: () => number;
}

/** Free space of the file system holding `path`, in percent. */
export function diskFreeOf(path: string): number | null {
  try {
    const s = statfsSync(path);
    return s.blocks > 0 ? Math.round((s.bavail / s.blocks) * 1000) / 10 : null;
  } catch {
    return null;
  }
}

export class HealthWatch {
  private health: { at: number; msg: SystemHealth } | null = null;
  private backup: BackupState | null = null;
  private restarts = new Map<string, { at: number; n: number }[]>();
  private hotSince: number | null = null;
  private tempC: number | null = null;
  /** Time of the watchdog's last beat (its own `ts`: a retained beat can be old); null = no Pi 3 watchdog installed. */
  private watchAt: number | null = null;
  private active = new Map<string, Problem>();
  private readonly startedAt: number;

  constructor(private readonly d: HealthDeps) {
    this.startedAt = this.now();
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** `vega/system/health`. Returns false for a payload outside the contract. */
  onHealth(payload: string): boolean {
    const r = systemHealth.safeParse(parse(payload));
    if (!r.success) return false;
    const at = this.now();
    this.health = { at, msg: r.data };
    for (const s of r.data.services) {
      const h = (this.restarts.get(s.name) ?? []).filter((x) => at - x.at <= RESTART_WINDOW);
      h.push({ at, n: s.restarts });
      this.restarts.set(s.name, h);
    }
    return true;
  }

  /** `vega/system/backup`. */
  onBackup(payload: string): boolean {
    const r = backupState.safeParse(parse(payload));
    if (r.success) this.backup = r.data;
    return r.success;
  }

  /** `vega/system/watch`: the Pi 3 watchdog is alive. */
  onWatch(payload: string): boolean {
    const r = watchBeat.safeParse(parse(payload));
    if (r.success) this.watchAt = Date.parse(r.data.ts);
    return r.success;
  }

  /** The SoC temperature from the brain's own Pi stats (every 30 s). */
  onTemp(tempC: number | null): void {
    this.tempC = tempC;
    if (tempC === null || tempC < HOT_C) this.hotSince = null;
    else this.hotSince ??= this.now();
  }

  /** What is wrong right now. */
  problems(): Problem[] {
    const now = this.now();
    const out: Problem[] = [];
    const h = this.health;
    if (!h) {
      if (now - this.startedAt > HEALTH_STALE) out.push({ key: 'health-stale', title: 'health check silent', detail: 'No report from infra/pi/health.sh: is its systemd timer running?' });
    } else if (now - h.at > HEALTH_STALE) {
      out.push({ key: 'health-stale', title: 'health check silent', detail: `Last report from health.sh ${ago(now - h.at)} ago.` });
    } else {
      for (const s of h.msg.services) {
        if (s.health === 'unhealthy' || !['running', 'restarting'].includes(s.state)) out.push({ key: `svc-${s.name}`, title: `${s.name} down`, detail: `${s.name} is ${s.health === 'unhealthy' ? 'unhealthy' : s.state}.` });
        const hist = this.restarts.get(s.name) ?? [];
        const n = hist.length > 1 ? hist[hist.length - 1]!.n - hist[0]!.n : 0;
        if (n >= RESTARTS_MAX) out.push({ key: `restart-${s.name}`, title: `${s.name} keeps restarting`, detail: `${s.name} restarted ${n} times in 10 minutes.` });
      }
    }
    const disk = this.d.diskFreePct();
    if (disk !== null && disk < DISK_MIN_PCT) out.push({ key: 'disk', title: 'disk almost full', detail: `${disk}% free on the Pi's disk.` });
    if (this.hotSince !== null && now - this.hotSince >= HOT_FOR) out.push({ key: 'hot', title: 'Pi too hot', detail: `The Pi has been at ${Math.round(this.tempC ?? HOT_C)} °C for ${ago(now - this.hotSince)}. Check its fan and airflow.` });
    if (this.watchAt !== null && now - this.watchAt > WATCH_STALE) out.push({ key: 'watch', title: 'Pi 3 watchdog silent', detail: `No heartbeat from the Pi 3 for ${ago(now - this.watchAt)}: nothing would tell your phone if this Pi went down.` });
    const phoneErr = this.d.phoneError?.() ?? null;
    if (phoneErr) out.push({ key: 'phone', title: 'phone alerts failing', detail: `ntfy on the Pi 3 refused or did not answer (${phoneErr}).` });
    const maxMs = this.d.backupMaxH * 60 * MIN;
    const b = this.backup;
    if (!b) {
      if (now - this.startedAt > maxMs) out.push({ key: 'backup', title: 'no backup', detail: `No backup reported in ${this.d.backupMaxH} h: is the vega-backup timer installed (setup.sh)?` });
    } else if (!b.ok) {
      out.push({ key: 'backup', title: 'backup failed', detail: `The last backup failed${b.error ? `: ${b.error}` : ''}.` });
    } else if (now - Date.parse(b.ts) > maxMs) {
      out.push({ key: 'backup', title: 'backup too old', detail: `Last backup ${ago(now - Date.parse(b.ts))} ago.` });
    }
    return out;
  }

  /** Compares with the last check: one Alert per new problem, a log line per cleared one. */
  check(): void {
    const now = this.problems();
    for (const p of now) {
      if (this.active.has(p.key)) continue;
      this.d.log(`[health] ${p.title}: ${p.detail}`);
      this.d.notify(
        { scene: 'alert', ttl: 300, level: 'high', status: 'System health', id: `health-${p.key}`, data: { title: p.title.slice(0, 60), ref: 'vega · pi', error: p.detail.slice(0, 300), note: 'Say "/status" for the whole picture, or open the Console.' } },
        `Health: ${p.title}`.slice(0, 80),
      );
    }
    for (const key of this.active.keys()) if (!now.some((p) => p.key === key)) this.d.log(`[health] cleared: ${this.active.get(key)!.title}`);
    this.active = new Map(now.map((p) => [p.key, p]));
  }

  /** For the Console: the latest reports as they came, plus the problems. */
  snapshot(): { services: SystemHealth['services'] | null; reportedAt: number | null; backup: BackupState | null; diskFreePct: number | null; watchAt: number | null; problems: Problem[] } {
    return { services: this.health?.msg.services ?? null, reportedAt: this.health?.at ?? null, backup: this.backup, diskFreePct: this.d.diskFreePct(), watchAt: this.watchAt, problems: this.problems() };
  }

  /** One line for `/status`. */
  summary(): string {
    const parts: string[] = [];
    const s = this.health?.msg.services;
    if (s) parts.push(`services ${s.filter((x) => x.state === 'running' && x.health !== 'unhealthy').length}/${s.length} ok`);
    const disk = this.d.diskFreePct();
    if (disk !== null) parts.push(`disk ${Math.round(disk)}% free`);
    const b = this.backup;
    parts.push(!b ? 'backup: none yet' : !b.ok ? 'backup: failed' : `backup ${ago(this.now() - Date.parse(b.ts))} ago${b.offsite ? '' : ' (on the Pi only)'}`);
    if (this.watchAt !== null) parts.push(this.now() - this.watchAt > WATCH_STALE ? 'watchdog silent' : 'watchdog ok');
    const p = this.problems();
    if (p.length) parts.push(`problems: ${p.map((x) => x.title).join(', ')}`);
    return parts.join(' · ');
  }
}

function parse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} d`;
}
