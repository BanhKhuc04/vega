/** Pure models for the virtual devices: values follow the time of day. */

/** Hourly CO₂ (ppm) in a closed bedroom: builds up overnight, drops in the morning. Same shape as the design's sample. */
export const CO2_BY_HOUR = [
  980, 1080, 1190, 1290, 1380, 1420, 1360, 1100, 820, 700, 640, 620, 650, 720, 780, 760, 740, 800, 860, 900, 940, 960, 940, 960,
];

/** Linear interpolation of the hourly table at a fractional hour (0..24, wraps around midnight). */
export function co2At(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const f = h - i;
  return CO2_BY_HOUR[i]! * (1 - f) + CO2_BY_HOUR[(i + 1) % 24]! * f;
}

export const hourOf = (d: Date): number => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

/** Indoor temperature: warmest mid-afternoon, coolest before dawn. */
export function tempAt(hour: number): number {
  return 26.5 + 2 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
}

/** Relative humidity moves opposite to temperature. */
export function humidityAt(hour: number): number {
  return 66 - 5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
}

/** Someone is at the desk most of the day, away overnight. */
export function presenceAt(hour: number): boolean {
  return hour >= 8 && hour < 23.5;
}

export interface Env {
  temp_c: number;
  humidity: number;
  co2_ppm: number;
}

/** One reading with a little noise. `rng` returns [0,1). */
export function envAt(d: Date, rng: () => number = Math.random): Env {
  const h = hourOf(d);
  const n = (a: number) => (rng() - 0.5) * 2 * a;
  return {
    temp_c: Math.round((tempAt(h) + n(0.15)) * 10) / 10,
    humidity: Math.round(humidityAt(h) + n(1)),
    co2_ppm: Math.round(co2At(h) + n(15)),
  };
}
