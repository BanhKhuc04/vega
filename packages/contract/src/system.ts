import { z } from 'zod';
import { PAYLOAD_VERSION } from './version';

const v = z.literal(PAYLOAD_VERSION);
const ts = z.iso.datetime({ offset: true });
const num = z.number().finite();

const ci = z.object({
  v,
  type: z.literal('ci'),
  repo: z.string().min(1).max(80),
  failed: z.number().int().min(0).max(999),
  ts: ts.optional(),
});
const nextEvent = z.object({
  v,
  type: z.literal('next_event'),
  title: z.string().min(1).max(80),
  detail: z.string().max(80).optional(),
  at: ts,
});
const co2Series = z.object({
  v,
  type: z.literal('co2_series'),
  room: z.string().min(1).max(40),
  values: z.array(num.min(0).max(100_000)).min(1).max(96),
  threshold_ppm: num.positive().optional(),
  max_ppm: num.positive().optional(),
});
/** A source the answer cites as [n] (M6): https only, so a display can link it safely. */
export const sourceRef = z.object({
  n: z.number().int().min(1).max(99),
  title: z.string().min(1).max(120),
  url: z.string().max(500).regex(/^https:\/\/\S+$/),
});
export type SourceRef = z.infer<typeof sourceRef>;

const commandResult = z.object({
  v,
  type: z.literal('command_result'),
  id: z.string().min(1).max(64),
  result: z.string().max(2000),
  /** What to read aloud when it differs from `result` (a research summary without the citations). */
  speak: z.string().min(1).max(300).optional(),
  sources: z.array(sourceRef).min(1).max(8).optional(),
  /** The answer was written by the AI on the owner's PC (v10, M15): the header shows LOCAL AI. */
  local_ai: z.literal(true).optional(),
});

/** AI spending of the brain on one local day, from its cost ledger (published after every LLM call). */
const llmUsage = z.object({
  v,
  type: z.literal('llm_usage'),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spent_usd: num.min(0),
  budget_usd: num.min(0),
  calls: z.number().int().min(0),
  tokens_in: z.number().int().min(0),
  tokens_out: z.number().int().min(0),
});

/** Something the brain says on its own (a reminder, the morning briefing): shown in the chat and read aloud. Not retained. */
const announce = z.object({
  v,
  type: z.literal('announce'),
  text: z.string().min(1).max(300),
  ts,
});

/** `vega/system/events`: one topic, discriminated by `type`. */
export const systemEvent = z.discriminatedUnion('type', [ci, nextEvent, co2Series, commandResult, llmUsage, announce]);

/** Local calendar day `YYYY-MM-DD` (the brain's budget day; the display compares against it). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export type SystemEvent = z.infer<typeof systemEvent>;

/** `vega/system/command`: published by the UI. */
/** `via: "voice"` (v5): spoken to the voice agent (pc-agent), which reads the answer aloud itself; screens show it, quietly. */
export const systemCommand = z.object({ v, id: z.string().min(1).max(64), text: z.string().min(1).max(500), ts, via: z.enum(['voice']).optional() });
export type SystemCommand = z.infer<typeof systemCommand>;

/** `vega/system/pi`: stats of the Raspberry Pi, published by the brain or a tiny agent. */
export const piStats = z.object({
  v,
  ts: ts.optional(),
  cpu_pct: num.min(0).max(100).optional(),
  temp_c: num.min(-50).max(150).optional(),
  mem_pct: num.min(0).max(100).optional(),
  uptime_s: num.min(0).optional(),
});
export type PiStats = z.infer<typeof piStats>;

/** `vega/system/health` (v8, retained): every container of the Pi stack, once a minute from infra/pi/health.sh. */
export const HEALTH_STATES = ['healthy', 'unhealthy', 'starting', 'none'] as const;
export const systemHealth = z.object({
  v,
  ts,
  services: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        state: z.string().min(1).max(20),
        health: z.enum(HEALTH_STATES),
        restarts: z.number().int().min(0).max(1_000_000),
      }),
    )
    .max(20),
});
export type SystemHealth = z.infer<typeof systemHealth>;

/** `vega/system/backup` (v8, retained): the last run of infra/pi/backup.sh. `offsite`: a copy also left the Pi. */
export const backupState = z.object({
  v,
  ts,
  ok: z.boolean(),
  bytes: z.number().int().min(0).optional(),
  offsite: z.boolean(),
  error: z.string().max(200).optional(),
});
export type BackupState = z.infer<typeof backupState>;

/** `vega/system/presence` (v8, retained): the owner is home or away, from the phone's location (brief 0013 B12). */
export const presenceState = z.object({ v, ts, state: z.enum(['home', 'away']) });
export type PresenceState = z.infer<typeof presenceState>;

/** `vega/system/watch` (v9, retained): heartbeat of the Pi 3 watchdog, every minute (brief 0014 P4). */
export const watchBeat = z.object({ v, ts });
export type WatchBeat = z.infer<typeof watchBeat>;

/** A location from OwnTracks (`owntracks/<user>/<device>`, `_type: location`): only the fields VEGA reads. */
export const owntracksLocation = z.object({
  _type: z.literal('location'),
  lat: num.min(-90).max(90),
  lon: num.min(-180).max(180),
  acc: num.min(0).max(100_000).optional(),
  tst: z.number().int().positive(),
  inregions: z.array(z.string().max(60)).max(20).optional(),
});
export type OwntracksLocation = z.infer<typeof owntracksLocation>;

/** `vega/system/net`: round-trip latency from the Pi to the broker. */
export const netStats = z.object({ v, ts: ts.optional(), latency_ms: num.min(0).max(60_000) });
export type NetStats = z.infer<typeof netStats>;
