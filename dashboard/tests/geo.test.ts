// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGeoShare } from '../src/ui/geo';

const pos = { coords: { latitude: 21.0285, longitude: 105.8542, accuracy: 12.6 } } as GeolocationPosition;
let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

function geo(ok = true) {
  return { getCurrentPosition: vi.fn((s: PositionCallback, e?: PositionErrorCallback | null) => (ok ? s(pos) : e?.({ code: 1 } as GeolocationPositionError))) } as unknown as Geolocation & { getCurrentPosition: ReturnType<typeof vi.fn> };
}

describe('startGeoShare', () => {
  it('on a phone: posts the position with the token, then every 2 minutes', () => {
    vi.useFakeTimers();
    const g = geo();
    const f = vi.fn(async () => new Response('{}'));
    stop = startGeoShare({ token: 'tok', geolocation: g, isPhone: true, fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/location');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ lat: 21.0285, lon: 105.8542, acc: 13 });
    vi.advanceTimersByTime(120_000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('never on a desktop or the kiosk', () => {
    const g = geo();
    expect(startGeoShare({ geolocation: g, isPhone: false })).toBeNull();
    expect(g.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('a refused permission sends nothing and throws nothing', () => {
    const f = vi.fn();
    stop = startGeoShare({ geolocation: geo(false), isPhone: true, fetchImpl: f as unknown as typeof fetch });
    expect(f).not.toHaveBeenCalled();
  });
});
