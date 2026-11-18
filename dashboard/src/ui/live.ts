import type { HudApi } from '../hud';
import type { Snapshot } from '../data/types';

/** Binds live values to the Idle screen, the header and the HUD callouts via `data-live` attributes. */

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const n2 = (n: number) => String(n).padStart(2, '0');

export function fmtAgo(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export function fmtIn(ms: number): string {
  if (ms <= 0) return 'now';
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  return h ? `in ${h} h ${n2(min % 60)} min` : `in ${min} min`;
}

const clock = (ts: number) => {
  const d = new Date(ts);
  return `${n2(d.getHours())}:${n2(d.getMinutes())}`;
};

export interface LiveText {
  roomName?: string;
  temp?: string;
  hum?: string;
  co2?: string;
  co2note?: string;
  co2Warn?: boolean;
  presence?: string;
  meshOn?: string;
  meshTotal?: string;
  meshKinds?: string;
  ci?: string;
  ciSub?: string;
  ciBad?: boolean;
  next?: string;
  nextSub?: string;
  piText?: string;
  coText?: string;
  meshText?: string;
  meshSub?: string;
  latText?: string;
  spark?: number[];
  /** True while any shown value is sample data (the whole screen in SIM, or until real data arrives). */
  sample: boolean;
}

/** Pure: snapshot -> the strings to show. Fields left undefined keep the template's own text. */
export function liveText(s: Snapshot, now: number): LiveText {
  const out: LiveText = { sample: false };
  const missing: boolean[] = [];

  if (s.env) {
    out.roomName = s.env.roomName;
    out.temp = s.env.tempC === null ? '—' : s.env.tempC.toFixed(1);
    out.hum = s.env.humidity === null ? '—' : String(Math.round(s.env.humidity));
    out.co2 = s.env.co2Ppm === null ? '—' : fmtInt(s.env.co2Ppm);
    const warn = s.env.co2Ppm !== null && s.env.co2Ppm > s.co2Threshold;
    out.co2Warn = warn;
    out.co2note = warn ? 'above threshold · open a window' : 'within range';
    if (s.co2Spark.length) out.spark = s.co2Spark;
  } else missing.push(true);

  if (s.presence !== null) out.presence = s.presence ? 'Occupied' : 'Away';
  else if (!s.isSample) missing.push(true);

  if (s.devices.length) {
    const online = s.devices.filter((d) => d.online).length;
    out.meshOn = String(online);
    out.meshTotal = String(s.devices.length);
    const counts = new Map<string, number>();
    for (const d of s.devices) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
    out.meshKinds = [...counts].map(([k, n]) => `${k} ×${n}`).join(' · ');
    out.meshText = `MESH · ${online}/${s.devices.length} ONLINE`;
    out.meshSub = out.meshKinds;
  } else missing.push(true);

  if (s.ci) {
    out.ciBad = s.ci.failed > 0;
    out.ci = s.ci.failed > 0 ? `${s.ci.failed} failed build${s.ci.failed > 1 ? 's' : ''}` : 'all builds passing';
    out.ciSub = `${s.ci.repo} · ${fmtAgo(now - s.ci.ts)}`;
  } else missing.push(true);

  if (s.next) {
    out.next = `${clock(s.next.at)} ${s.next.title}`;
    out.nextSub = s.next.detail ?? fmtIn(s.next.at - now);
  } else missing.push(true);

  if (s.pi && s.pi.tempC !== null) {
    out.piText = `PI · ${Math.round(s.pi.tempC)}°C`;
    out.coText = `CORE TEMP · ${Math.round(s.pi.tempC)}°C`;
  } else missing.push(true);

  if (s.net) out.latText = `LATENCY · ${Math.round(s.net.latencyMs)} MS`;
  else missing.push(true);

  out.sample = s.isSample || missing.length > 0;
  return out;
}

const COUNTED = new Set(['temp', 'hum', 'co2', 'meshOn']);

export class LiveBinder {
  private last = new Map<string, string>();
  private first = true;

  constructor(
    private readonly hud: Pick<HudApi, 'zap' | 'getMode' | 'barHtml'>,
    private readonly root: ParentNode = document,
  ) {}

  render(s: Snapshot, now: number = Date.now()): void {
    const t = liveText(s, now);
    const visible = ['idle', 'listen', 'think'].includes(this.hud.getMode());
    const set = (key: string, value: string | undefined) => {
      if (value === undefined) return;
      const el = this.root.querySelector<HTMLElement>(`[data-live="${key}"]`);
      if (!el) return;
      if (this.last.get(key) === value) return;
      this.last.set(key, value);
      if (COUNTED.has(key) && el.dataset.count !== undefined) {
        const num = Number(value.replace(/,/g, ''));
        if (Number.isFinite(num)) el.dataset.count = String(num);
      }
      if (visible && !this.first) this.hud.zap(el, value);
      else el.textContent = value;
    };
    for (const k of ['roomName', 'temp', 'hum', 'co2', 'co2note', 'presence', 'meshOn', 'meshTotal', 'meshKinds', 'ci', 'ciSub', 'next', 'nextSub', 'piText', 'coText', 'meshText', 'meshSub', 'latText'] as const) {
      set(k, t[k]);
    }
    const toggle = (key: string, cls: string, on: boolean | undefined) => {
      if (on === undefined) return;
      this.root.querySelector(`[data-live="${key}"]`)?.classList.toggle(cls, on);
    };
    toggle('co2row', 'warn', t.co2Warn);
    toggle('cirow', 'bad', t.ciBad);
    if (t.spark) {
      const key = t.spark.join(',');
      if (this.last.get('spark') !== key) {
        this.last.set('spark', key);
        const sp = this.root.querySelector('#spark');
        if (sp) sp.innerHTML = this.hud.barHtml(t.spark); // numbers only: no network text in this HTML
      }
    }
    const tag = this.root.querySelector<HTMLElement>('#sampleTag');
    if (tag) tag.hidden = !t.sample;
    this.first = false;
  }
}
