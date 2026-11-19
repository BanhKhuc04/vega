/**
 * The personal assistant (Brief 0006): calendar, mail and weather kept fresh in the background, the morning
 * briefing, reminders and Focus. Everything VEGA shows on its own goes through `notify`, which holds it during Focus.
 */
import type { Bus, SceneOut } from './bus';
import type { Config } from './config';
import type { CiWatcher } from './github';
import { GoogleError } from './google';
import type { CalEvent, GoogleApi, Mail } from './google';
import { roomLabel } from './registry';
import type { Registry } from './registry';
import type { Reminder, Store } from './store';
import { clip } from './text';
import { weatherText } from './weather';
import type { Weather } from './weather';

export type Lang = 'vi' | 'en';
export const L = (lang: Lang, vi: string, en: string) => (lang === 'vi' ? vi : en);
/** Vietnamese if the text has Vietnamese letters, otherwise the fallback. */
export const langOf = (text: string, fallback: Lang): Lang => (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text) ? 'vi' : fallback);

const MIN = 60_000;
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const startOfDay = (ms: number, plusDays = 0) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays).getTime();
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export interface AssistantDeps {
  bus: Bus;
  registry: Registry;
  store: Store;
  config: Config;
  ci?: CiWatcher | null;
  google?: GoogleApi | null;
  weather?: (() => Promise<Weather>) | null;
  now?: () => number;
  log?: (msg: string) => void;
  /** setTimeout, replaceable in tests. */
  later?: (fn: () => void, ms: number) => void;
}

interface Held {
  scene: SceneOut;
  label: string;
  speech?: string;
}

export class Assistant {
  events: CalEvent[] = [];
  mail: Mail[] = [];
  weather: Weather | null = null;
  /** Last successful polls (0 = never). */
  calendarAt = 0;
  mailAt = 0;
  weatherAt = 0;
  private googleError = '';
  private nextKey = '';
  private focus: { until: number; minutes: number; held: Held[] } | null = null;
  private lastFired: Reminder | null = null;
  private briefedDay = '';
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly later: (fn: () => void, ms: number) => void;

  constructor(private readonly deps: AssistantDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    this.later = deps.later ?? ((fn, ms) => void setTimeout(fn, ms));
    // started after today's briefing time: no catching up (G6)
    if (this.now() >= this.briefingTime(this.now())) this.briefedDay = new Date(this.now()).toDateString();
  }

  get googleOn(): boolean {
    return !!this.deps.google && !this.deps.google.auth.dead;
  }

  start(): void {
    const every = (ms: number, fn: () => unknown) => {
      void fn();
      this.timers.push(setInterval(() => void fn(), ms));
    };
    every(15_000, () => this.tick());
    if (this.deps.google) {
      if (!this.deps.google.auth.hasLogin()) this.log('[google] not signed in: run "npm run google-login" to see calendar and mail');
      every(5 * MIN, () => this.pollCalendar());
      every(10 * MIN, () => this.pollMail());
    }
    if (this.deps.weather) every(30 * MIN, () => this.pollWeather());
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // --- background data ---

  async pollCalendar(): Promise<boolean> {
    const g = this.deps.google;
    if (!g || g.auth.dead || !g.auth.hasLogin()) return false;
    try {
      const now = this.now();
      this.events = await g.events(startOfDay(now), startOfDay(now, 2));
      this.calendarAt = now;
      this.googleError = '';
      this.publishNext();
      return true;
    } catch (e) {
      return this.googleFailed(e);
    }
  }

  async pollMail(): Promise<boolean> {
    const g = this.deps.google;
    if (!g || g.auth.dead || !g.auth.hasLogin()) return false;
    try {
      this.mail = await g.unread();
      this.mailAt = this.now();
      this.googleError = '';
      return true;
    } catch (e) {
      return this.googleFailed(e);
    }
  }

  async pollWeather(): Promise<boolean> {
    if (!this.deps.weather) return false;
    try {
      this.weather = await this.deps.weather();
      this.weatherAt = this.now();
      return true;
    } catch (e) {
      this.log(`[weather] ${(e as Error).message}`);
      return false;
    }
  }

  /** Logs a Google problem once (not every poll); offline keeps the last data. */
  private googleFailed(e: unknown): false {
    const msg = e instanceof GoogleError ? e.message : `Google: ${(e as Error).message}`;
    if (msg !== this.googleError) this.log(`[google] ${msg}`);
    this.googleError = msg;
    return false;
  }

  /** The next timed event goes to the Idle screen's "next event" row. */
  private publishNext(): void {
    const now = this.now();
    const next = this.events.find((e) => !e.allDay && e.start > now);
    const key = next ? `${next.start}|${next.title}|${next.location ?? ''}` : '';
    if (!next || key === this.nextKey) return;
    this.nextKey = key;
    this.deps.bus.nextEvent(clip(next.title, 80), next.location ? clip(next.location, 80) : undefined, next.start);
  }

  // --- answers ---

  calendarText(day: 'today' | 'tomorrow' | 'next', lang: Lang): string {
    if (!this.deps.google) return L(lang, 'Chưa kết nối lịch Google: xem README, mục M4.', 'Google Calendar is not set up: see the README, section M4.');
    if (!this.calendarAt) return L(lang, 'Chưa đọc được lịch Google (chạy npm run google-login).', 'The calendar has not been read yet (run npm run google-login).');
    const now = this.now();
    const fmt = (e: CalEvent) => `${e.allDay ? L(lang, 'cả ngày', 'all day') : hhmm(e.start)} ${e.title}`;
    if (day === 'next') {
      const e = this.events.find((x) => !x.allDay && x.start > now);
      return e ? L(lang, `Lịch tiếp theo: ${fmt(e)}.`, `Next: ${fmt(e)}.`) : L(lang, 'Không còn lịch nào tới hết ngày mai.', 'Nothing else until the end of tomorrow.');
    }
    const from = startOfDay(now, day === 'today' ? 0 : 1);
    const list = this.events.filter((e) => e.start >= from && e.start < startOfDay(from, 1));
    const when = day === 'today' ? L(lang, 'Hôm nay', 'Today') : L(lang, 'Ngày mai', 'Tomorrow');
    if (!list.length) return L(lang, `${when} không có lịch.`, `${when}: nothing on the calendar.`);
    return clip(`${when}: ${list.map(fmt).join('; ')}.`, 480);
  }

  mailText(lang: Lang): string {
    if (!this.deps.google) return L(lang, 'Chưa kết nối Gmail: xem README, mục M4.', 'Gmail is not set up: see the README, section M4.');
    if (!this.mailAt) return L(lang, 'Chưa đọc được Gmail (chạy npm run google-login).', 'Gmail has not been read yet (run npm run google-login).');
    if (!this.mail.length) return L(lang, 'Không có mail mới trong Hộp thư chính.', 'No new mail in your Primary inbox.');
    const list = this.mail.map((m) => `${m.from}: ${m.subject}`).join('; ');
    return clip(L(lang, `${this.mail.length} mail chưa đọc. ${list}.`, `${plural(this.mail.length, 'unread email')}. ${list}.`), 480);
  }

  weatherSentence(lang: Lang): string {
    const w = this.weather;
    if (!w) return this.deps.weather ? L(lang, 'Chưa lấy được thời tiết.', 'No weather data yet.') : L(lang, 'Chưa đặt toạ độ thời tiết (WEATHER_LAT, WEATHER_LON).', 'Weather is not set up (WEATHER_LAT, WEATHER_LON).');
    const rain = w.rainPct >= 30 ? L(lang, `, khả năng mưa ${Math.round(w.rainPct)}%`, `, ${Math.round(w.rainPct)}% chance of rain`) : '';
    return L(
      lang,
      `Trời ${Math.round(w.tempC)} độ, ${weatherText(w.code, 'vi')}, hôm nay ${Math.round(w.minC)} đến ${Math.round(w.maxC)} độ${rain}.`,
      `${Math.round(w.tempC)}°C, ${weatherText(w.code, 'en')}, today ${Math.round(w.minC)} to ${Math.round(w.maxC)}°C${rain}.`,
    );
  }

  // --- reminders ---

  addReminder(at: number, text: string, lang: Lang): string {
    const r = this.deps.store.addReminder(at, text, this.now());
    const day = startOfDay(at) === startOfDay(this.now()) ? '' : startOfDay(at) === startOfDay(this.now(), 1) ? L(lang, ' ngày mai', ' tomorrow') : ` ${new Date(at).toLocaleDateString('en-GB')}`;
    return L(lang, `Được, ${hhmm(at)}${day} mình sẽ nhắc: ${text} (#${r.id}).`, `OK, I'll remind you at ${hhmm(at)}${day}: ${text} (#${r.id}).`);
  }

  remindersText(lang: Lang): string {
    const list = this.deps.store.pendingReminders();
    if (!list.length) return L(lang, 'Không có lời nhắc nào.', 'No reminders.');
    const today = startOfDay(this.now());
    const when = (at: number) => (startOfDay(at) === today ? hhmm(at) : `${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric' })} ${hhmm(at)}`);
    return clip(list.map((r) => `#${r.id} ${when(r.at)} ${r.text}`).join('; '), 480);
  }

  cancelReminder(id: number, lang: Lang): string {
    return this.deps.store.cancelReminder(id) ? L(lang, `Đã huỷ lời nhắc #${id}.`, `Reminder #${id} cancelled.`) : L(lang, `Không có lời nhắc #${id}.`, `There is no reminder #${id}.`);
  }

  /** Snooze 10 min: the reminder that fired last goes back in the queue. */
  snooze(lang: Lang): string {
    const r = this.lastFired;
    if (!r) return L(lang, 'Không có lời nhắc nào để hoãn.', 'Nothing to snooze.');
    const at = this.now() + 10 * MIN;
    this.deps.store.rescheduleReminder(r.id, at);
    this.lastFired = null;
    const l = langOf(r.text, lang); // the Snooze button sends English "snooze": answer in the reminder's language
    return L(l, `Được, ${hhmm(at)} mình nhắc lại: ${r.text}.`, `OK, again at ${hhmm(at)}: ${r.text}.`);
  }

  private fire(r: Reminder): void {
    const lang = langOf(r.text, this.deps.config.lang);
    const missed = this.now() - r.at > 60 * MIN;
    this.lastFired = r;
    const speech = missed ? L(lang, `Lời nhắc bị lỡ lúc ${hhmm(r.at)}: ${r.text}`, `Missed reminder from ${hhmm(r.at)}: ${r.text}`) : L(lang, `Nhắc bạn: ${r.text}`, `Reminder: ${r.text}`);
    this.notify(
      {
        scene: 'alert',
        ttl: 600,
        status: missed ? 'Missed reminder' : 'Reminder',
        data: { title: missed ? 'missed reminder' : 'reminder', ref: `#${r.id} · ${hhmm(r.at)}`, error: clip(r.text, 300), note: missed ? 'VEGA was off when this was due.' : 'Snooze for 10 minutes or dismiss.', snooze: true },
      },
      clip(`Reminder: ${r.text}`, 80),
      clip(speech, 300),
    );
  }

  // --- Focus: what VEGA shows on its own waits until it ends (G8) ---

  notify(scene: SceneOut, label: string, speech?: string): void {
    if (this.focus) {
      this.focus.held.push({ scene, label, ...(speech && { speech }) });
      return;
    }
    this.show(scene, speech);
  }

  /** Speech first: the dev broker (aedes) drops a retained publish (the scene) followed at once by a plain one. */
  private show(scene: SceneOut, speech?: string): void {
    if (speech) this.deps.bus.announce(speech);
    this.deps.bus.scene(scene);
  }

  get focusing(): boolean {
    return this.focus !== null;
  }

  startFocus(minutes: number): SceneOut {
    this.focus = { until: this.now() + minutes * MIN, minutes, held: this.focus?.held ?? [] };
    return this.focusScene()!;
  }

  /** The Focus screen with the time left, or null when not focusing. */
  focusScene(): SceneOut | null {
    if (!this.focus) return null;
    const left = Math.max(1, Math.ceil((this.focus.until - this.now()) / 1000));
    return { scene: 'focus', ttl: left, status: 'Deep work · notifications held', data: { minutes: Math.max(1, Math.round(left / 60)), hint: 'Notifications are held until the timer ends. Say "stop focus" to end early.' } };
  }

  /**
   * Ends Focus early ("stop focus"): returns the "Focus done" screen and sentence for the answer; the newest held
   * alert follows 10 s later. null when not focusing.
   */
  stopFocus(lang: Lang): { scene: SceneOut; text: string } | null {
    const f = this.focus;
    if (!f) return null;
    this.focus = null;
    const held = f.held;
    const scene: SceneOut = {
      scene: 'success',
      ttl: held.length ? 10 : 20,
      status: 'Focus done',
      data: { title: 'focus done', ref: `${f.minutes} min`, checks: held.length ? held.slice(-6).map((h) => h.label) : ['No interruptions'] },
    };
    const text = held.length
      ? L(lang, `Hết giờ tập trung. Có ${held.length} thông báo đang chờ.`, `Focus done. ${plural(held.length, 'notification')} waiting.`)
      : L(lang, 'Hết giờ tập trung.', 'Focus done.');
    if (held.length) {
      this.later(() => {
        if (this.focus) return void this.focus.held.push(...held); // a new Focus started meanwhile
        const speech = held.map((h) => h.speech).filter(Boolean).join(' · ');
        this.show(held.at(-1)!.scene, speech ? clip(speech, 300) : undefined);
      }, 10_000);
    }
    return { scene, text };
  }

  /** The timer ran out: VEGA says so on its own. */
  private endFocus(): void {
    const end = this.stopFocus(this.deps.config.lang);
    if (!end) return;
    this.show(end.scene, end.text);
  }

  // --- briefing (G6): built here, no AI call ---

  private briefingTime(ms: number): number {
    const [h, m] = this.deps.config.briefingAt.split(':').map(Number);
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  }

  briefing(lang: Lang): { scene: SceneOut; speech: string } {
    const { registry: reg, config, ci } = this.deps;
    const now = this.now();
    const hour = new Date(now).getHours();
    const greet = hour < 12 ? L(lang, 'Chào buổi sáng.', 'Good morning.') : hour < 18 ? L(lang, 'Chào buổi chiều.', 'Good afternoon.') : L(lang, 'Chào buổi tối.', 'Good evening.');
    const today = this.events.filter((e) => e.start >= startOfDay(now) && e.start < startOfDay(now, 1));
    const upcoming = today.find((e) => e.allDay || e.start > now);
    const parts = [greet];
    if (this.googleOn && this.calendarAt) {
      parts.push(
        !today.length
          ? L(lang, 'Hôm nay không có lịch.', 'Nothing on the calendar today.')
          : L(lang, `Hôm nay có ${today.length} lịch`, `${plural(today.length, 'event')} today`) +
              (upcoming ? L(lang, `, tiếp theo là ${upcoming.allDay ? '' : `${hhmm(upcoming.start)} `}${upcoming.title}.`, `, next ${upcoming.allDay ? '' : `${hhmm(upcoming.start)} `}${upcoming.title}.`) : '.'),
      );
    }
    if (this.googleOn && this.mailAt) parts.push(this.mail.length ? L(lang, `${this.mail.length} mail chưa đọc.`, `${plural(this.mail.length, 'unread email')}.`) : L(lang, 'Không có mail mới.', 'No new mail.'));
    if (this.weather) parts.push(this.weatherSentence(lang));
    const st = ci?.latest();
    if (st?.failing.length) parts.push(L(lang, `${st.failing.length} build đang hỏng.`, `${plural(st.failing.length, 'build')} failing.`));
    const speech = clip(parts.join(' '), 300);

    const room = config.defaultRoom;
    const read = (m: 'temp' | 'humidity' | 'co2') => {
      const d = reg.sensors(m, room).find((x) => x.online) ?? reg.sensors(m, room)[0];
      return d ? reg.reading(d, m) : undefined;
    };
    const [t, h, c] = [read('temp'), read('humidity'), read('co2')];
    const roomText = [t !== undefined && `${t.toFixed(1)}°C`, h !== undefined && `${Math.round(h)}%`, c !== undefined && `CO₂ ${Math.round(c)} ppm`].filter(Boolean).join(' · ');
    const scene: SceneOut = {
      scene: 'briefing',
      ttl: 300,
      status: 'Morning briefing',
      data: {
        kicker: new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        title: hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening',
        summary: clip(parts.slice(1).join(' ') || greet, 200),
        // every panel gets real data or says it is empty: a missing field would show the template's sample content
        agenda: today.length
          ? today.slice(0, 8).map((e) => ({ time: e.allDay ? 'all day' : hhmm(e.start), title: clip(e.title, 60), ...(e === upcoming && { hot: true }) }))
          : [{ time: '—', title: this.googleOn && this.calendarAt ? 'Nothing on the calendar' : 'Calendar not connected' }],
        inbox:
          this.googleOn && this.mailAt
            ? this.mail.length
              ? this.mail.slice(0, 6).map((m) => ({ from: clip(m.from, 30), subject: clip(m.subject, 100) }))
              : [{ from: '—', subject: 'No new mail' }]
            : [{ from: '—', subject: 'Gmail not connected' }],
        room: clip(roomText ? `${roomLabel(reg, room)} ${roomText}` : 'No room readings yet', 200),
        builds: st ? { passing: st.passing.length, failing: st.failing.length, ...(st.failing[0] && { repo: st.failing[0].repo.slice(0, 60) }) } : { passing: 0, failing: 0 },
      },
    };
    return { scene, speech };
  }

  /** Reads again what is older than 5 minutes, waiting 8 s at most (the briefing is shown with what there is). */
  async refresh(): Promise<void> {
    const now = this.now();
    const fresh = [now - this.calendarAt > 5 * MIN && this.pollCalendar(), now - this.mailAt > 5 * MIN && this.pollMail(), this.pollWeather()].filter((p): p is Promise<boolean> => p !== false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(fresh), new Promise((r) => (timer = setTimeout(r, 8000)))]);
    clearTimeout(timer);
  }

  /** Every 15 s: due reminders, the end of Focus, the daily briefing, the next event moving on. */
  async tick(): Promise<void> {
    const now = this.now();
    for (const r of this.deps.store.takeDueReminders(now)) this.fire(r);
    if (this.focus && now >= this.focus.until) this.endFocus();
    const day = new Date(now).toDateString();
    if (this.briefedDay !== day && now >= this.briefingTime(now)) {
      this.briefedDay = day;
      this.log('[assistant] morning briefing');
      await this.refresh();
      const b = this.briefing(this.deps.config.lang);
      this.notify(b.scene, 'Morning briefing', b.speech);
    }
    this.publishNext();
  }
}
