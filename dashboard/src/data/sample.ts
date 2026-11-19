import { localDay } from '@vega/contract';
import type { Snapshot } from './types';

/** CO₂ series used by the template's chart and sparkline (24 hourly values, scale 0–1500, threshold 1000). */
export const SAMPLE_CO2 = [
  980, 1080, 1190, 1290, 1380, 1420, 1360, 1100, 820, 700, 640, 620, 650, 720, 780, 760, 740, 800,
  860, 900, 940, 960, 940, 960,
];

/** Baseline values of the template (what the screenshots show). */
export const BASELINE = { tempC: 28.4, humidity: 72, co2Ppm: 1180, piTempC: 52, cpuPct: 23, latencyMs: 38 };

/** Next local occurrence of hh:mm, as epoch ms. */
export function nextLocal(hh: number, mm: number, now: number): number {
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function emptySnapshot(kind: 'mock' | 'mqtt', primaryRoom = 'bedroom'): Snapshot {
  return {
    sourceKind: kind,
    isSample: kind === 'mock',
    conn: kind === 'mock' ? 'sim' : 'reconnecting',
    primaryRoom,
    env: null,
    roomNames: {},
    co2Spark: [],
    co2Threshold: 1000,
    presence: null,
    devices: [],
    ci: null,
    ai: null,
    next: null,
    co2Series: null,
    pi: null,
    net: null,
    core: 'idle',
  };
}

export function sampleSnapshot(now: number): Snapshot {
  const kinds = [
    ['bedroom/env', 'esp8266'],
    ['bedroom/radar', 'esp8266'],
    ['livingroom/light', 'esp8266'],
    ['kitchen/plug', 'esp8266'],
    ['balcony/env', 'esp8266'],
    ['desk/core', 'esp32-s3'],
  ] as const;
  return {
    ...emptySnapshot('mock'),
    env: { room: 'bedroom', roomName: 'Bedroom', tempC: BASELINE.tempC, humidity: BASELINE.humidity, co2Ppm: BASELINE.co2Ppm, ts: now },
    roomNames: { bedroom: 'Bedroom' },
    co2Spark: [...SAMPLE_CO2.slice(0, 23), BASELINE.co2Ppm],
    presence: true,
    devices: kinds.map(([id, kind]) => ({ id, kind, online: true })),
    ci: { repo: 'firmware-esp', failed: 1, ts: now - 4 * 60_000 },
    ai: { day: localDay(now), spentUsd: 0.0012, budgetUsd: 0.05, calls: 4 },
    next: { title: 'lab report', detail: 'computer networks', at: nextLocal(16, 30, now) },
    co2Series: { room: 'bedroom', values: SAMPLE_CO2, thresholdPpm: 1000, maxPpm: 1500 },
    pi: { cpuPct: BASELINE.cpuPct, tempC: BASELINE.piTempC, memPct: 41, uptimeS: 6 * 86400 },
    net: { latencyMs: BASELINE.latencyMs },
  };
}
