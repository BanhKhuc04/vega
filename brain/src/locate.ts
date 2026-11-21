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

/** A fix older or vaguer than this cannot become home. */
const HOME_FIX_MAX_AGE = 10 * 60_000;
const HOME_FIX_MAX_ACC = 150;

export class Locator {
  private last: Location | null;
  private home: boolean | null = null;
  /** The home circle: saved with "đây là nhà", else HOME_LAT / HOME_LON (or the weather coordinates). */
  private circle: { lat: number; lon: number; radiusM: number } | null;

  constructor(private readonly d: LocatorDeps) {
    const saved = d.store.savedHome();
    this.circle = saved ? { ...saved, radiusM: d.home?.radiusM ?? 150 } : d.home;
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
    return this.circle ? distanceM(l, this.circle) <= this.circle.radiusM : l.regions.length ? false : null;
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
    this.accept({ device: topic.split('/')[2]!.slice(0, 40), lat: r.data.lat, lon: r.data.lon, accM: r.data.acc ?? null, ts: r.data.tst * 1000, regions: r.data.inregions ?? [] });
  }

  /** A position from any source: OwnTracks, or the VEGA page open on the phone (POST /api/location). Returns false if older. */
  accept(l: Location): boolean {
    if (this.last && l.ts <= this.last.ts) return false; // an older point delivered late (the phone was offline)
    this.last = l;
    this.d.store.saveLocation(l);
    const home = this.isHome(l);
    if (home !== null && home !== this.home) {
      this.home = home;
      this.d.log(`[locate] owner ${home ? 'home' : 'away'}`);
      this.d.presence(home);
    }
    return true;
  }

  /** "đây là nhà": the phone's latest position becomes home, if it is fresh and precise enough. */
  setHomeHere(lang: Lang): { ok: boolean; text: string } {
    const l = this.last;
    if (!l || this.now() - l.ts > HOME_FIX_MAX_AGE)
      return { ok: false, text: L(lang, 'Chưa có vị trí mới từ điện thoại. Mở VEGA trên điện thoại (cho phép Vị trí) rồi nói lại.', 'No fresh position from the phone. Open VEGA on the phone (allow Location), then say it again.') };
    if (l.accM !== null && l.accM > HOME_FIX_MAX_ACC)
      return { ok: false, text: L(lang, `Vị trí điện thoại chưa đủ chính xác (±${Math.round(l.accM)} m). Ra gần cửa sổ, đợi một chút rồi nói lại.`, `The phone's position is not precise enough (±${Math.round(l.accM)} m). Move near a window, wait a moment, then say it again.`) };
    this.d.store.saveHome(l.lat, l.lon);
    this.circle = { lat: l.lat, lon: l.lon, radiusM: this.circle?.radiusM ?? this.d.home?.radiusM ?? 150 };
    this.d.log('[locate] home set from the phone');
    if (this.home !== true) {
      this.home = true;
      this.d.presence(true);
    }
    return { ok: true, text: L(lang, `Đã lưu đây là nhà (bán kính ${this.circle.radiusM} m).`, `Saved: this is home (radius ${this.circle.radiusM} m).`) };
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
    const km = this.circle ? distanceM(l, this.circle) / 1000 : null;
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
