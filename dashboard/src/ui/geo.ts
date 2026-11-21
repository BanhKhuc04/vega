/**
 * The phone's position without any app (M8): when the VEGA page is open on a touch screen (iPhone, Android, also as the
 * installed home-screen app), it sends the browser's position to the brain (POST /api/location) on opening, when it comes
 * back to the front, and every 2 minutes while visible. The OS asks the owner once. Desktops and the Pi kiosk never send:
 * their position would be the house's, not the owner's. A web page cannot do this while closed (iOS rule).
 */
const EVERY_MS = 120_000;

export interface GeoDeps {
  token?: string | undefined;
  geolocation?: Geolocation | undefined;
  isPhone?: boolean;
  fetchImpl?: typeof fetch;
}

export function startGeoShare(d: GeoDeps = {}): (() => void) | null {
  const geo = d.geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);
  const phone = d.isPhone ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  if (!geo || !phone) return null;
  const post = d.fetchImpl ?? fetch;
  let busy = false;
  const send = () => {
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    geo.getCurrentPosition(
      (p) => {
        busy = false;
        void post('/api/location', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(d.token && { authorization: `Bearer ${d.token}` }) },
          body: JSON.stringify({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
        }).catch(() => {}); // offline, or SIM mode without a brain: the next try goes through
      },
      () => {
        busy = false; // refused or no fix: VEGA simply has no position from this phone
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 },
    );
  };
  send();
  const timer = setInterval(send, EVERY_MS);
  document.addEventListener('visibilitychange', send);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', send);
  };
}
