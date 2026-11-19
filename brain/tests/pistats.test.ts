import { describe, expect, it } from 'vitest';
import { piStatsReader } from '../src/pistats';

describe('piStatsReader', () => {
  it('reads memory from MemAvailable and the SoC temperature; values stay in range', () => {
    const files: Record<string, string> = { '/proc/meminfo': 'MemTotal: 999 kB\nMemAvailable:    1 kB\n', '/sys/class/thermal/thermal_zone0/temp': '52412\n' };
    const s = piStatsReader((p) => files[p] ?? null)();
    expect(s.tempC).toBe(52.4);
    expect(s.memPct).toBeGreaterThanOrEqual(0);
    expect(s.memPct).toBeLessThanOrEqual(100);
    expect(s.cpuPct).toBeGreaterThanOrEqual(0);
    expect(s.uptimeS).toBeGreaterThan(0);
  });
  it('a machine without a thermal zone (a PC) reports no temperature', () => {
    expect(piStatsReader(() => null)().tempC).toBeNull();
  });
});
