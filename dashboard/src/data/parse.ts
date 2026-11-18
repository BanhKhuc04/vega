import { CORE_STATES, DEVICE_KINDS } from './types';
import type { CoreState, DeviceKind, ResearchSession, Tone } from './types';

/** Contract version understood by this UI. See docs/mqtt-contract.md. */
export const CONTRACT_VERSION = 1;

export type Update =
  | { type: 'env'; room: string; deviceId: string; tempC: number | null; humidity: number | null; co2Ppm: number | null; ts: number }
  | { type: 'availability'; room: string; deviceId: string; online: boolean }
  | { type: 'meta'; room: string; deviceId: string; kind: DeviceKind; roomName: string | null }
  | { type: 'ci'; repo: string; failed: number; ts: number }
  | { type: 'next'; title: string; at: number }
  | { type: 'co2'; room: string; values: number[]; thresholdPpm: number; maxPpm: number }
  | { type: 'research'; session: ResearchSession }
  | { type: 'commandResult'; id: string; result: string }
  | { type: 'core'; state: CoreState };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): number | null | undefined => (v === undefined || v === null ? null : isNum(v) ? v : undefined);

function parseJson(payload: string): Obj | null {
  try {
    const v: unknown = JSON.parse(payload);
    return isObj(v) && v.v === CONTRACT_VERSION ? v : null;
  } catch {
    return null;
  }
}

function parseTs(v: unknown, fallback: number): number {
  if (isStr(v)) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

/** Split `vega/<room>/<device>/<leaf>`; returns null for any other shape. */
function deviceTopic(topic: string): { room: string; deviceId: string; leaf: string } | null {
  const p = topic.split('/');
  if (p.length !== 4 || p[0] !== 'vega') return null;
  const [, room, deviceId, leaf] = p as [string, string, string, string];
  if (!room || !deviceId) return null;
  return { room, deviceId, leaf };
}

function parseSteps(v: unknown): ResearchSession['steps'] | null {
  if (!Array.isArray(v)) return null;
  const out: ResearchSession['steps'] = [];
  for (const s of v) {
    if (!isObj(s) || !isStr(s.label)) return null;
    const state = s.state;
    if (state !== 'done' && state !== 'active' && state !== 'todo') return null;
    const step: ResearchSession['steps'][number] = { label: s.label, state };
    if (isStr(s.detail)) step.detail = s.detail;
    if (isNum(s.progress)) step.progress = Math.max(0, Math.min(1, s.progress));
    out.push(step);
  }
  return out;
}

const TONES: readonly Tone[] = ['good', 'warn', 'plain'];

function parseCompare(v: unknown): ResearchSession['compare'] | null {
  if (!isObj(v) || !isStr(v.title) || !Array.isArray(v.columns) || !v.columns.every(isStr) || !Array.isArray(v.rows)) return null;
  const rows: ResearchSession['compare']['rows'] = [];
  for (const r of v.rows) {
    if (!isObj(r) || !isStr(r.label) || !Array.isArray(r.cells)) return null;
    const cells: { text: string; tone: Tone }[] = [];
    for (const c of r.cells) {
      if (!isObj(c) || !isStr(c.text)) return null;
      const tone = TONES.find((t) => t === c.tone) ?? 'plain';
      cells.push({ text: c.text, tone });
    }
    rows.push({ label: r.label, cells });
  }
  return { title: v.title, columns: v.columns, rows };
}

function parseResearch(o: Obj): ResearchSession | null {
  const s = o.session;
  if (!isObj(s)) return null;
  const steps = parseSteps(s.steps);
  const compare = parseCompare(s.compare);
  if (!isStr(s.id) || !isStr(s.title) || !steps || !compare) return null;
  if (!isNum(s.step_no) || !isNum(s.step_count) || !isStr(s.phase)) return null;
  return {
    id: s.id,
    title: s.title,
    stepNo: s.step_no,
    stepCount: s.step_count,
    phase: s.phase,
    sources: isNum(s.sources) ? s.sources : 0,
    sourcesDesc: isStr(s.sources_desc) ? s.sources_desc : '',
    ref: isStr(s.ref) ? s.ref : s.id,
    steps,
    sourceCaption: isStr(s.source_caption) ? s.source_caption : '',
    compare,
    note: isStr(s.note) ? s.note : '',
    noteRefs: isStr(s.note_refs) ? s.note_refs : '',
  };
}

function parseEvent(o: Obj, now: number): Update | null {
  switch (o.type) {
    case 'ci':
      if (!isStr(o.repo) || !isNum(o.failed) || o.failed < 0) return null;
      return { type: 'ci', repo: o.repo, failed: o.failed, ts: parseTs(o.ts, now) };
    case 'next_event': {
      if (!isStr(o.title) || !isStr(o.at)) return null;
      const at = Date.parse(o.at);
      return Number.isFinite(at) ? { type: 'next', title: o.title, at } : null;
    }
    case 'co2_series': {
      if (!isStr(o.room) || !Array.isArray(o.values) || o.values.length === 0 || o.values.length > 96) return null;
      if (!o.values.every((x) => isNum(x) && x >= 0)) return null;
      const thresholdPpm = isNum(o.threshold_ppm) && o.threshold_ppm > 0 ? o.threshold_ppm : 1000;
      const maxPpm = isNum(o.max_ppm) && o.max_ppm > 0 ? o.max_ppm : 1500;
      return { type: 'co2', room: o.room, values: o.values as number[], thresholdPpm, maxPpm };
    }
    case 'research': {
      const session = parseResearch(o);
      return session ? { type: 'research', session } : null;
    }
    case 'command_result':
      return isStr(o.id) && isStr(o.result) ? { type: 'commandResult', id: o.id, result: o.result } : null;
    default:
      return null;
  }
}

/**
 * Turns one MQTT message into a typed update. Never throws: corrupt JSON, wrong contract
 * version or wrong schema all return null.
 */
export function parseMessage(topic: string, payload: string, now: number = Date.now()): Update | null {
  try {
    if (topic === 'vega/system/events') {
      const o = parseJson(payload);
      return o ? parseEvent(o, now) : null;
    }
    if (topic === 'vega/desk/core/state') {
      const o = parseJson(payload);
      const state = o ? CORE_STATES.find((s) => s === o.state) : undefined;
      return state ? { type: 'core', state } : null;
    }
    const t = deviceTopic(topic);
    if (!t || t.room === 'system') return null;
    if (t.leaf === 'availability') {
      const v = payload.trim().toLowerCase();
      if (v !== 'online' && v !== 'offline') return null;
      return { type: 'availability', room: t.room, deviceId: t.deviceId, online: v === 'online' };
    }
    if (t.leaf === 'meta') {
      const o = parseJson(payload);
      if (!o) return null;
      const kind = DEVICE_KINDS.find((k) => k === o.kind) ?? 'unknown';
      return { type: 'meta', room: t.room, deviceId: t.deviceId, kind, roomName: isStr(o.room_name) ? o.room_name : null };
    }
    if (t.leaf === 'state') {
      const o = parseJson(payload);
      if (!o) return null;
      const tempC = numOrNull(o.temp_c);
      const humidity = numOrNull(o.humidity);
      const co2Ppm = numOrNull(o.co2_ppm);
      if (tempC === undefined || humidity === undefined || co2Ppm === undefined) return null;
      if (tempC === null && humidity === null && co2Ppm === null) return null; // not an environment sensor
      return { type: 'env', room: t.room, deviceId: t.deviceId, tempC, humidity, co2Ppm, ts: parseTs(o.ts, now) };
    }
    return null;
  } catch {
    return null;
  }
}
