/** Weather from Open-Meteo (free, no key; Brief 0006, G5). */

export interface Weather {
  tempC: number;
  /** Today's forecast. */
  minC: number;
  maxC: number;
  rainPct: number;
  code: number;
}

/** WMO weather code → short text. */
export function weatherText(code: number, lang: 'vi' | 'en'): string {
  const [vi, en] =
    code === 0 ? ['trời quang', 'clear'] :
    code <= 3 ? ['có mây', 'cloudy'] :
    code <= 48 ? ['sương mù', 'fog'] :
    code <= 57 ? ['mưa phùn', 'drizzle'] :
    code <= 67 || (code >= 80 && code <= 82) ? ['mưa', 'rain'] :
    code <= 77 || code === 85 || code === 86 ? ['tuyết', 'snow'] :
    ['dông', 'thunderstorms'];
  return lang === 'vi' ? vi : en;
}

export async function fetchWeather(cfg: { lat: number; lon: number; apiUrl: string }, f: typeof fetch = fetch): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(cfg.lat),
    longitude: String(cfg.lon),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    timezone: 'auto',
    forecast_days: '1',
  });
  let res: Response;
  try {
    res = await f(`${cfg.apiUrl}/v1/forecast?${q}`, { signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Error(`weather unreachable: ${(e as Error).message}`, { cause: e });
  }
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const j = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[]; weather_code?: number[] };
  };
  const tempC = j.current?.temperature_2m;
  if (typeof tempC !== 'number') throw new Error('weather: unexpected answer');
  return {
    tempC,
    minC: j.daily?.temperature_2m_min?.[0] ?? tempC,
    maxC: j.daily?.temperature_2m_max?.[0] ?? tempC,
    rainPct: j.daily?.precipitation_probability_max?.[0] ?? 0,
    code: j.daily?.weather_code?.[0] ?? j.current?.weather_code ?? 0,
  };
}
