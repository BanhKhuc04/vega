/**
 * The owner's phone (M8, brief 0013 B10–B12): OwnTracks publishes its location over MQTT (through Tailscale). The brain
 * keeps only the latest point, says home or away on vega/system/presence, and answers "where am I" with the Locate screen.
 * Coordinates never go into a log line, a command answer or an AI call: only the screen shows them.
 */
import { owntracksLocation } from '@vega/contract';
import type { Lang } from './assistant';
import { L } from './assistant';
import type { SceneOut } from './bus';
import { ago } from './health';
import type { Location, Store } from './store';
import { fold } from './text';

export interface LocatorDeps {
  store: Store;
  home: { lat: number; lon: number; radiusM: number } | null;
  /** OwnTracks region names that mean home (folded before comparing). */
  homeRegions: string[];
  /** Publishes vega/system/presence (retained). */
  presence(home: boolean): void;
  log(msg: string): void;
  now?: () => number;
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "cập nhật 3 phút trước" / "updated 3 min ago", for the spoken answer. */
export function updatedText(ms: number, lang: Lang): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return L(lang, 'vừa cập nhật', 'just updated');
  const [n, vi, en] = m < 60 ? [m, 'phút', 'min'] : m < 48 * 60 ? [Math.round(m / 60), 'giờ', 'h'] : [Math.round(m / 1440), 'ngày', 'd'];
  return L(lang, `cập nhật ${n} ${vi} trước`, `updated ${n} ${en} ago`);
}

export class Locator {
  private last: Location | null;
  private home: boolean | null = null;

  constructor(private readonly d: LocatorDeps) {
    this.last = d.store.lastLocation();
    if (this.last) this.home = this.isHome(this.last);
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** Home when the phone is inside a home region, or inside the home circle. */
  isHome(l: Location): boolean | null {
    const names = new Set(this.d.homeRegions.map(fold));
    if (l.regions.some((r) => names.has(fold(r)))) return true;
    // shortcut: no hysteresis at the circle's edge; a jittery fix there may flip home/away, add a margin if it does
    return this.d.home ? distanceM(l, this.d.home) <= this.d.home.radiusM : l.regions.length ? false : null;
  }

  /** `owntracks/<user>/<device>`. Other OwnTracks messages (transitions, waypoints, last will) are ignored. */
  onMessage(topic: string, payload: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      return;
    }
    const r = owntracksLocation.safeParse(raw);
    if (!r.success) return;
    const tsMs = r.data.tst * 1000;
    if (this.last && tsMs <= this.last.ts) return; // an older point delivered late (the phone was offline)
    const l: Location = { device: topic.split('/')[2]!.slice(0, 40), lat: r.data.lat, lon: r.data.lon, accM: r.data.acc ?? null, ts: tsMs, regions: r.data.inregions ?? [] };
    this.last = l;
    this.d.store.saveLocation(l);
    const home = this.isHome(l);
    if (home !== null && home !== this.home) {
      this.home = home;
      this.d.log(`[locate] owner ${home ? 'home' : 'away'}`);
      this.d.presence(home);
    }
  }

  /** Re-sends the current presence (after the broker reconnects). */
  republish(): void {
    if (this.home !== null) this.d.presence(this.home);
  }

  get latest(): Location | null {
    return this.last;
  }

  get atHome(): boolean | null {
    return this.home;
  }

  /** "tôi đang ở đâu": the sentence (no coordinates) and the Locate screen. */
  answer(lang: Lang): { text: string; scene: SceneOut | null } {
    const l = this.last;
    if (!l) return { text: L(lang, 'Chưa có vị trí từ điện thoại. Cài OwnTracks theo docs/pi-setup.md.', 'No location from the phone yet. Set up OwnTracks (docs/pi-setup.md).'), scene: null };
    const since = ago(this.now() - l.ts);
    const region = l.regions[0];
    const km = this.d.home ? distanceM(l, this.d.home) / 1000 : null;
    const kmText = km === null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', lang === 'vi' ? ',' : '.')} km`;
    const upd = updatedText(this.now() - l.ts, lang);
    const text =
      this.home ? L(lang, `Bạn đang ở nhà (${upd}).`, `You are home (${upd}).`)
      : km !== null ? L(lang, `Bạn đang cách nhà ${kmText}${region ? `, ở ${region}` : ''} (${upd}).`, `You are ${kmText} from home${region ? `, at ${region}` : ''} (${upd}).`)
      : L(lang, `Đã có vị trí điện thoại (${upd}), xem trên màn Locate.`, `Phone located (${upd}), see the Locate screen.`);
    const coord = `${Math.abs(l.lat).toFixed(4)}° ${l.lat >= 0 ? 'N' : 'S'} · ${Math.abs(l.lon).toFixed(4)}° ${l.lon >= 0 ? 'E' : 'W'}`;
    const steps = [km !== null ? `${kmText} from home` : 'home not set (HOME_LAT / HOME_LON)', l.accM !== null ? `accuracy ±${Math.round(l.accM)} m` : 'accuracy unknown', `updated ${since} ago`, ...(l.regions.length ? [`in ${l.regions.join(', ')}`.slice(0, 80)] : [])];
    const scene: SceneOut = {
      scene: 'locate',
      ttl: 120,
      status: `Locate · ${l.device}`.slice(0, 60),
      data: {
        title: `Locate: ${this.home ? 'home' : region ?? 'phone'}`.slice(0, 80),
        status: `${l.device} · ${since} ago`.slice(0, 60),
        target: {
          name: (this.home ? 'home' : this.home === false ? 'away' : 'phone').slice(0, 60),
          ...(km !== null && { distanceKm: Math.round(km * 10) / 10 }),
          detail: (l.accM !== null ? `±${Math.round(l.accM)} m · ${since} ago` : `${since} ago`).slice(0, 120),
          coord,
          lat: l.lat,
          lon: l.lon,
          ...(l.accM !== null && { accuracyM: Math.min(100_000, l.accM) }),
        },
        route: { title: 'position', steps },
      },
    };
    return { text, scene };
  }
}
