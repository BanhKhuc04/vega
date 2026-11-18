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
const commandResult = z.object({
  v,
  type: z.literal('command_result'),
  id: z.string().min(1).max(64),
  result: z.string().max(500),
});

/** `vega/system/events`: one topic, discriminated by `type`. */
export const systemEvent = z.discriminatedUnion('type', [ci, nextEvent, co2Series, commandResult]);
export type SystemEvent = z.infer<typeof systemEvent>;

/** `vega/system/command`: published by the UI. */
export const systemCommand = z.object({ v, id: z.string().min(1).max(64), text: z.string().min(1).max(500), ts });
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

/** `vega/system/net`: round-trip latency from the Pi to the broker. */
export const netStats = z.object({ v, ts: ts.optional(), latency_ms: num.min(0).max(60_000) });
export type NetStats = z.infer<typeof netStats>;
