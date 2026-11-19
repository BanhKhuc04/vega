import { z } from 'zod';
import { PAYLOAD_VERSION } from './version';

/**
 * UI scene protocol: `vega/ui/scene` (retained). The brain decides which screen is shown and with what
 * data; every display renders the same scene. Every `data` field is optional: a missing field falls back to
 * the text and numbers already in the template. A wrong type anywhere rejects the whole message.
 */
export const SCENES = ['idle', 'listen', 'think', 'research', 'locate', 'vision', 'briefing', 'focus', 'alert', 'success', 'sleep'] as const;
export type SceneName = (typeof SCENES)[number];
export const LEVELS = ['normal', 'medium', 'high'] as const;
export type Level = (typeof LEVELS)[number];

const s = (max: number) => z.string().max(max);
const sn = (max: number) => z.string().min(1).max(max);
const stepState = z.enum(['done', 'run', 'wait']);
const tone = z.enum(['ok', 'warn', 'plain']);
const num = z.number().finite();

export const idleData = z.object({ caption: sn(80).optional() });

export const listenData = z.object({ transcript: sn(300).optional(), hint: sn(120).optional() });

export const thinkData = z.object({
  chips: z.array(z.object({ label: sn(40), state: stepState })).min(1).max(6).optional(),
  plan: sn(200).optional(),
});

export const researchData = z.object({
  title: sn(120).optional(),
  step: z.object({ current: z.number().int().min(0).max(99), total: z.number().int().min(1).max(99), label: sn(40) }).optional(),
  stat: z
    .object({
      sources: z.number().int().min(0).max(9999),
      text: s(160).optional(),
      ref: s(24).optional(),
      progress: num.min(0).max(1).optional(),
    })
    .optional(),
  chart: z
    .object({
      title: sn(60).optional(),
      values: z.array(num.min(0).max(100_000)).min(1).max(96),
      thresholdPpm: num.positive().optional(),
      maxPpm: num.positive().optional(),
      summary: sn(240).optional(),
      footnote: sn(80).optional(),
    })
    .optional(),
  steps: z.array(z.object({ label: sn(60), state: stepState })).min(1).max(8).optional(),
  source: z.object({ title: sn(40).optional(), caption: sn(100).optional() }).optional(),
  compare: z
    .object({
      title: sn(40),
      columns: z.array(sn(24)).min(2).max(4),
      rows: z
        .array(z.object({ label: sn(40), cells: z.array(z.object({ text: s(40), tone: tone.optional() })).min(1).max(3) }))
        .min(1)
        .max(8),
    })
    .optional(),
  note: z.object({ text: sn(400), refs: s(80).optional() }).optional(),
  log: z.array(z.object({ tag: sn(12), msg: sn(120) })).min(1).max(30).optional(),
});

export const locateData = z.object({
  title: sn(80).optional(),
  status: sn(60).optional(),
  target: z
    .object({
      name: sn(60).optional(),
      distanceKm: num.min(0).max(20_000).optional(),
      detail: sn(120).optional(),
      coord: sn(40).optional(),
    })
    .optional(),
  route: z.object({ title: sn(40).optional(), steps: z.array(sn(80)).min(1).max(8) }).optional(),
});

export const visionData = z.object({ camera: sn(80).optional() });

export const briefingData = z.object({
  kicker: sn(60).optional(),
  title: sn(60).optional(),
  summary: sn(200).optional(),
  agenda: z.array(z.object({ time: sn(8), title: sn(60), hot: z.boolean().optional() })).min(1).max(8).optional(),
  inbox: z.array(z.object({ from: sn(30), subject: sn(100) })).min(1).max(6).optional(),
  room: sn(200).optional(),
  builds: z.object({ passing: z.number().int().min(0).max(999), failing: z.number().int().min(0).max(999), repo: s(60).optional() }).optional(),
});

export const focusData = z.object({
  kicker: sn(80).optional(),
  minutes: z.number().int().min(1).max(180).optional(),
  hint: sn(120).optional(),
});

export const alertData = z.object({
  title: sn(60).optional(),
  ref: sn(60).optional(),
  error: sn(300).optional(),
  note: sn(160).optional(),
  /** A confirmation the brain is waiting for: the card shows Confirm / Cancel, which send "yes" / "no". */
  confirm: z.boolean().optional(),
  /** The card shows Explain, which asks the brain why (a failed build). */
  explain: z.boolean().optional(),
  /** Page with the details (a CI run): the card shows Open, which opens it in a new tab. https only. */
  url: z.string().max(300).regex(/^https:\/\/\S+$/).optional(),
});

export const successData = z.object({
  title: sn(60).optional(),
  ref: sn(60).optional(),
  checks: z.array(sn(80)).min(1).max(6).optional(),
});

export const sleepData = z.object({
  title: sn(40).optional(),
  lightsOffSeconds: z.number().int().min(0).max(600).optional(),
  alarm: sn(8).optional(),
  dnd: z.boolean().optional(),
});

export const sceneDataSchemas = {
  idle: idleData,
  listen: listenData,
  think: thinkData,
  research: researchData,
  locate: locateData,
  vision: visionData,
  briefing: briefingData,
  focus: focusData,
  alert: alertData,
  success: successData,
  sleep: sleepData,
} as const;

const envelope = {
  v: z.literal(PAYLOAD_VERSION),
  level: z.enum(LEVELS).optional(),
  /** Reserved: the orb currently follows the scene. Accepted so the brain can send it already. */
  orb: z.enum(['idle', 'listen', 'think', 'speak', 'alert', 'sleep']).optional(),
  status: sn(60).optional(),
  /** Seconds the scene stays up (counted from `ts`, or from arrival if `ts` is missing). Then back to idle. */
  ttl: z.number().int().min(1).max(86_400).optional(),
  ts: z.iso.datetime({ offset: true }).optional(),
  id: sn(64).optional(),
};
const mk = <N extends SceneName, D extends z.ZodType>(name: N, data: D) =>
  z.object({ ...envelope, scene: z.literal(name), data: data.optional() });

export const sceneMessage = z.discriminatedUnion('scene', [
  mk('idle', idleData),
  mk('listen', listenData),
  mk('think', thinkData),
  mk('research', researchData),
  mk('locate', locateData),
  mk('vision', visionData),
  mk('briefing', briefingData),
  mk('focus', focusData),
  mk('alert', alertData),
  mk('success', successData),
  mk('sleep', sleepData),
]);
export type SceneMessage = z.infer<typeof sceneMessage>;
export type SceneDataOf<N extends SceneName> = z.infer<(typeof sceneDataSchemas)[N]>;

export type SceneParseResult = { ok: true; scene: SceneMessage } | { ok: false; error: string };

/** Parses a raw MQTT payload (string) or an already-decoded value. Never throws. */
export function parseScene(raw: unknown): SceneParseResult {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'invalid JSON' };
    }
  }
  const r = sceneMessage.safeParse(value);
  if (r.success) return { ok: true, scene: r.data };
  const first = r.error.issues[0];
  const path = first ? first.path.join('.') || '(root)' : '(root)';
  return { ok: false, error: `${path}: ${first?.message ?? 'invalid'}` };
}

/** Epoch ms at which a scene expires, or null if it never does. `now` is used when the message has no `ts`. */
export function sceneExpiresAt(scene: SceneMessage, now: number): number | null {
  if (scene.ttl === undefined) return null;
  const base = scene.ts ? Date.parse(scene.ts) : now;
  return (Number.isFinite(base) ? base : now) + scene.ttl * 1000;
}
