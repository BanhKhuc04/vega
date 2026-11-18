import type { Co2Series } from './types';

export interface Bar {
  hour: number;
  ppm: number;
  heightPct: number;
  over: boolean;
}

export function barModel(series: Co2Series): Bar[] {
  return series.values.map((ppm, hour) => ({
    hour,
    ppm,
    heightPct: Math.max(0, Math.min(100, (ppm / series.maxPpm) * 100)),
    over: ppm > series.thresholdPpm,
  }));
}

export function thresholdPct(series: Co2Series): number {
  return (series.thresholdPpm / series.maxPpm) * 100;
}

export function peak(series: Co2Series): { hour: number; ppm: number } | null {
  let best: { hour: number; ppm: number } | null = null;
  series.values.forEach((ppm, hour) => {
    if (!best || ppm > best.ppm) best = { hour, ppm };
  });
  return best;
}

export function hoursOver(series: Co2Series): number {
  return series.values.filter((v) => v > series.thresholdPpm).length;
}
