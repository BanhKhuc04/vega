import type { SceneMessage } from '@vega/contract';
import type { CoreState, Snapshot } from '../data/types';

/**
 * The small front screen (2.8" 320×240, no touch) driven by one rotary knob with a push button.
 * The knob arrives as keys (infra/pi/knob.py): turn = ArrowDown / ArrowUp, press = Enter, long press = Escape.
 * Everything here is pure so it runs in tests; mini/main.ts only paints it.
 */
export type Key = 'up' | 'down' | 'enter' | 'back';

export function keyOf(key: string): Key | null {
  if (key === 'ArrowDown' || key === 'ArrowRight') return 'down';
  if (key === 'ArrowUp' || key === 'ArrowLeft') return 'up';
  if (key === 'Enter' || key === ' ') return 'enter';
  if (key === 'Escape' || key === 'Backspace') return 'back';
  return null;
}

export const PAGES = ['home', 'system', 'next', 'actions'] as const;
export type Page = (typeof PAGES)[number];

export interface Action {
  label: string;
  command: string;
}
/** Quick commands: plain sentences the brain already understands when typed. */
export const ACTIONS: readonly Action[] = [
  { label: 'Bản tin sáng', command: 'briefing' },
  { label: 'Xem camera', command: 'xem camera' },
  { label: 'Tập trung 25 phút', command: 'tập trung 25 phút' },
  { label: 'Dừng tập trung', command: 'dừng tập trung' },
  { label: 'Chế độ ngủ', command: 'chế độ ngủ' },
];

export interface Choice {
  label: string;
  command: string | null;
}
export interface Prompt {
  title: string;
  choices: Choice[];
}

export interface NavState {
  page: number;
  inList: boolean;
  item: number;
  prompt: Prompt | null;
  choice: number;
}
export const initialNav = (): NavState => ({ page: 0, inList: false, item: 0, prompt: null, choice: 0 });

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** One knob event. `send` is a command to publish, or null. A question from the brain always comes first. */
export function step(s: NavState, key: Key, actions: readonly Action[] = ACTIONS): { state: NavState; send: string | null } {
  const d = key === 'down' ? 1 : key === 'up' ? -1 : 0;
  if (s.prompt) {
    if (d) return { state: { ...s, choice: wrap(s.choice + d, s.prompt.choices.length) }, send: null };
    const send = key === 'enter' ? (s.prompt.choices[s.choice]?.command ?? null) : null;
    return { state: { ...s, prompt: null, choice: 0 }, send };
  }
  if (s.inList) {
    if (d) return { state: { ...s, item: wrap(s.item + d, actions.length) }, send: null };
    const send = key === 'enter' ? (actions[s.item]?.command ?? null) : null;
    return { state: { ...s, inList: false }, send };
  }
  if (d) return { state: { ...s, page: wrap(s.page + d, PAGES.length) }, send: null };
  if (key === 'enter' && PAGES[s.page] === 'actions') return { state: { ...s, inList: true, item: 0 }, send: null };
  if (key === 'back') return { state: { ...s, page: 0 }, send: null };
  return { state: s, send: null };
}

/** The question an alert scene asks, or null. Cancel is listed first so a stray press never confirms. */
export function promptOf(scene: SceneMessage): Prompt | null {
  if (scene.scene !== 'alert' || !scene.data) return null;
  const d = scene.data;
  const title = d.title ?? d.note ?? 'Xác nhận';
  if (d.confirm) return { title, choices: [{ label: 'Huỷ', command: 'no' }, { label: 'Đồng ý', command: 'yes' }] };
  if (d.snooze) return { title, choices: [{ label: 'Đã xem', command: null }, { label: 'Báo lại 10 phút', command: 'snooze' }] };
  return null;
}

const SCENE_LABEL: Record<SceneMessage['scene'], string> = {
  idle: 'Sẵn sàng',
  listen: 'Đang nghe',
  think: 'Đang suy nghĩ',
  research: 'Đang tìm hiểu',
  locate: 'Định vị',
  vision: 'Camera',
  briefing: 'Bản tin',
  focus: 'Tập trung',
  alert: 'Cảnh báo',
  success: 'Xong',
  sleep: 'Chế độ ngủ',
};

/** Heading and one line for a scene on the small screen; idle shows the pages instead. */
export function sceneText(scene: SceneMessage): { label: string; line: string } {
  const label = SCENE_LABEL[scene.scene];
  switch (scene.scene) {
    case 'listen':
      return { label, line: scene.data?.transcript ?? '…' };
    case 'think':
      return { label, line: scene.data?.plan ?? '' };
    case 'research':
      return { label, line: scene.data?.title ?? '' };
    case 'focus':
      return { label, line: scene.data?.minutes ? `${scene.data.minutes} phút` : '' };
    case 'alert':
      return { label, line: scene.data?.title ?? scene.data?.error ?? scene.data?.note ?? '' };
    case 'success':
      return { label, line: scene.data?.title ?? '' };
    default:
      return { label, line: scene.status ?? '' };
  }
}

const CORE_LABEL: Record<CoreState, string> = {
  idle: 'Sẵn sàng',
  listening: 'Đang nghe',
  thinking: 'Đang suy nghĩ',
  speaking: 'Đang nói',
  alert: 'Cảnh báo',
  sleep: 'Đang ngủ',
};

const n2 = (n: number) => String(n).padStart(2, '0');

export function inVi(ms: number): string {
  if (ms <= 0) return 'bây giờ';
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  return h ? `${h} giờ ${n2(min % 60)} phút nữa` : `${min} phút nữa`;
}

export function uptimeVi(s: number): string {
  const h = Math.floor(s / 3600);
  return h >= 24 ? `${Math.floor(h / 24)} ngày ${h % 24} giờ` : `${h} giờ ${Math.floor((s % 3600) / 60)} phút`;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '--' : `${Math.round(v)}%`);
const deg = (v: number | null | undefined) => (v === null || v === undefined ? '--' : `${v.toFixed(1)}°C`);

export interface PageView {
  title: string;
  /** One big figure (or short text) under the title. */
  big: string;
  rows: [string, string][];
  warn?: boolean;
}

export function pageView(page: Page, s: Snapshot, now: number): PageView {
  switch (page) {
    case 'home': {
      const e = s.env;
      const co2 = e?.co2Ppm ?? null;
      return {
        title: e?.roomName ?? 'Phòng',
        big: deg(e?.tempC),
        warn: co2 !== null && co2 >= s.co2Threshold,
        rows: [
          ['Độ ẩm', pct(e?.humidity)],
          ['CO₂', co2 === null ? '--' : `${Math.round(co2)} ppm`],
          ['Có người', s.presence === null ? '--' : s.presence ? 'có' : 'không'],
          ['VEGAS', CORE_LABEL[s.core]],
        ],
      };
    }
    case 'system': {
      const p = s.pi;
      const rows: [string, string][] = [
        ['CPU', pct(p?.cpuPct)],
        ['RAM', pct(p?.memPct)],
        ['Chạy được', p?.uptimeS ? uptimeVi(p.uptimeS) : '--'],
        ['Mạng', s.net ? `${Math.round(s.net.latencyMs)} ms` : '--'],
      ];
      if (s.ai) rows.push(['AI hôm nay', `$${s.ai.spentUsd.toFixed(2)} / $${s.ai.budgetUsd.toFixed(2)}`]);
      if (s.ci && s.ci.failed > 0) rows.push(['CI lỗi', `${s.ci.failed} · ${s.ci.repo}`]);
      return { title: 'Pi 4', big: deg(p?.tempC), warn: (p?.tempC ?? 0) >= 75, rows };
    }
    case 'next':
      return s.next
        ? { title: 'Việc tiếp theo', big: inVi(s.next.at - now), rows: [[s.next.title, s.next.detail ?? '']] }
        : { title: 'Việc tiếp theo', big: 'Trống', rows: [['Không có lời nhắc nào', '']] };
    case 'actions':
      return { title: 'Lệnh nhanh', big: '', rows: [] };
  }
}
