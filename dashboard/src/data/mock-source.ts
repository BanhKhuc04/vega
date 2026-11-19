import type { SceneMessage } from '@vega/contract';
import { BASELINE, SAMPLE_CO2, sampleSnapshot } from './sample';
import type { Snapshot, VegaDataSource } from './types';

export interface MockOptions {
  now?: () => number;
  rng?: () => number;
  intervalMs?: number;
}

const between = (rng: () => number, a: number, b: number) => a + rng() * (b - a);

/** One simulation step: jitter around the template's baseline values (same ranges the template used). */
export function simStep(s: Snapshot, now: number, rng: () => number): Snapshot {
  const co2 = Math.round(between(rng, 1160, 1205));
  const env = s.env && {
    ...s.env,
    tempC: Math.round(between(rng, 28.2, 28.7) * 10) / 10,
    humidity: Math.round(between(rng, 70, 74)),
    co2Ppm: co2,
    ts: now,
  };
  return {
    ...s,
    env,
    co2Spark: [...s.co2Spark, co2].slice(-24),
    pi: { cpuPct: Math.round(between(rng, 18, 30)), tempC: Math.round(between(rng, 51, 54)), memPct: 41, uptimeS: (s.pi?.uptimeS ?? 0) + 2 },
    net: { latencyMs: Math.round(between(rng, 31, 47)) },
  };
}

/** SIM mode: the dashboard runs on its own, with sample data and no broker. */
export class MockSource implements VegaDataSource {
  readonly kind = 'mock' as const;
  private snap: Snapshot;
  private listeners = new Set<(s: Snapshot) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly intervalMs: number;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
    this.intervalMs = opts.intervalMs ?? 2000;
    this.snap = sampleSnapshot(this.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.intervalMs);
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  step(): void {
    this.snap = simStep(this.snap, this.now(), this.rng);
    this.emit();
  }

  getSnapshot(): Snapshot {
    return this.snap;
  }

  subscribe(listener: (s: Snapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snap);
    return () => this.listeners.delete(listener);
  }

  onScene(_listener: (s: SceneMessage) => void): () => void {
    return () => {}; // SIM has no brain; scenes come from #hash only
  }

  onResult(_listener: (id: string, text: string) => void): () => void {
    return () => {};
  }

  sendCommand(_text: string): string | null {
    return null;
  }

  private emit(): void {
    for (const l of this.listeners) l(this.snap);
  }
}

export { BASELINE, SAMPLE_CO2 };
