import { readFileSync } from 'node:fs';
import { cpus, freemem, totalmem, uptime } from 'node:os';

export interface PiStats {
  cpuPct: number;
  memPct: number;
  tempC: number | null;
  uptimeS: number;
}

type Times = { idle: number; total: number };
const times = (): Times =>
  cpus().reduce(
    (a, c) => {
      const t = c.times;
      return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq };
    },
    { idle: 0, total: 0 },
  );

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Stats of the machine the brain runs on (the Pi). CPU is measured between two calls; memory uses MemAvailable when
 * Linux has it (free memory alone counts the page cache as used); temperature from the SoC thermal zone, if any.
 */
export function piStatsReader(readFile: (path: string) => string | null = read): () => PiStats {
  let prev = times();
  return () => {
    const now = times();
    const dt = now.total - prev.total;
    const cpuPct = dt > 0 ? Math.round((1 - (now.idle - prev.idle) / dt) * 100) : 0;
    prev = now;
    const avail = /MemAvailable:\s+(\d+) kB/.exec(readFile('/proc/meminfo') ?? '');
    const memPct = Math.round((1 - (avail ? Number(avail[1]) * 1024 : freemem()) / totalmem()) * 100);
    const t = Number(readFile('/sys/class/thermal/thermal_zone0/temp'));
    return { cpuPct: Math.min(100, Math.max(0, cpuPct)), memPct: Math.min(100, Math.max(0, memPct)), tempC: Number.isFinite(t) && t > 0 ? Math.round(t / 100) / 10 : null, uptimeS: Math.round(uptime()) };
  };
}
