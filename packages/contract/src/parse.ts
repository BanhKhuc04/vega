import { availability, coreState, deviceMeta, deviceState } from './device';
import type { CoreStateMsg, DeviceKind, Risk } from './device';
import { parseScene } from './scene';
import type { SceneMessage } from './scene';
import { netStats, piStats, systemCommand, systemEvent } from './system';
import type { SourceRef } from './system';
import { CORE_STATE, SYSTEM_COMMAND, SYSTEM_NET, SYSTEM_PI, UI_SCENE, isEventsTopic, parseDeviceTopic } from './topics';

/** One MQTT message, decoded and validated. */
export type Update =
  | { type: 'state'; room: string; deviceId: string; tempC?: number; humidity?: number; co2Ppm?: number; presence?: boolean; on?: boolean; ts: number }
  | { type: 'availability'; room: string; deviceId: string; online: boolean }
  | { type: 'meta'; room: string; deviceId: string; kind: DeviceKind; roomName: string | null; name: string | null; aliases: string[]; risk: Risk | null }
  | { type: 'ci'; repo: string; failed: number; ts: number }
  | { type: 'nextEvent'; title: string; detail: string | null; at: number }
  | { type: 'co2Series'; room: string; values: number[]; thresholdPpm: number; maxPpm: number }
  | { type: 'commandResult'; id: string; result: string; speak: string | null; sources: SourceRef[] }
  | { type: 'announce'; text: string; ts: number }
  | { type: 'llmUsage'; day: string; spentUsd: number; budgetUsd: number; calls: number; tokensIn: number; tokensOut: number }
  | { type: 'core'; state: CoreStateMsg['state']; mic: NonNullable<CoreStateMsg['mic']> | null }
  | { type: 'voiceCommand'; id: string; text: string }
  | { type: 'pi'; cpuPct: number | null; tempC: number | null; memPct: number | null; uptimeS: number | null }
  | { type: 'net'; latencyMs: number }
  | { type: 'scene'; scene: SceneMessage }
  | { type: 'sceneInvalid'; error: string };

function json(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

const t = (iso: string | undefined, fallback: number): number => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Decodes and validates one message. Never throws. Returns null for anything that is not part of the
 * contract (corrupt JSON, wrong schema, unknown topic or `type`), except scene payloads, which return
 * `sceneInvalid` so the display can warn once.
 */
export function parseMessage(topic: string, payload: string, now: number = Date.now()): Update | null {
  try {
    if (topic === UI_SCENE) {
      if (payload === '') return null; // retained message was cleared
      const r = parseScene(payload);
      return r.ok ? { type: 'scene', scene: r.scene } : { type: 'sceneInvalid', error: r.error };
    }
    if (topic === SYSTEM_COMMAND) {
      // only what the voice agent heard is news to a screen; typed commands come from a screen itself
      const r = systemCommand.safeParse(json(payload));
      return r.success && r.data.via === 'voice' ? { type: 'voiceCommand', id: r.data.id, text: r.data.text } : null;
    }
    if (isEventsTopic(topic)) {
      const r = systemEvent.safeParse(json(payload));
      if (!r.success) return null;
      const e = r.data;
      switch (e.type) {
        case 'ci':
          return { type: 'ci', repo: e.repo, failed: e.failed, ts: t(e.ts, now) };
        case 'next_event':
          return { type: 'nextEvent', title: e.title, detail: e.detail ?? null, at: t(e.at, now) };
        case 'co2_series':
          return { type: 'co2Series', room: e.room, values: e.values, thresholdPpm: e.threshold_ppm ?? 1000, maxPpm: e.max_ppm ?? 1500 };
        case 'command_result':
          return { type: 'commandResult', id: e.id, result: e.result, speak: e.speak ?? null, sources: e.sources ?? [] };
        case 'announce':
          return { type: 'announce', text: e.text, ts: t(e.ts, now) };
        case 'llm_usage':
          return { type: 'llmUsage', day: e.day, spentUsd: e.spent_usd, budgetUsd: e.budget_usd, calls: e.calls, tokensIn: e.tokens_in, tokensOut: e.tokens_out };
      }
    }
    if (topic === SYSTEM_PI) {
      const r = piStats.safeParse(json(payload));
      if (!r.success) return null;
      const p = r.data;
      return { type: 'pi', cpuPct: p.cpu_pct ?? null, tempC: p.temp_c ?? null, memPct: p.mem_pct ?? null, uptimeS: p.uptime_s ?? null };
    }
    if (topic === SYSTEM_NET) {
      const r = netStats.safeParse(json(payload));
      return r.success ? { type: 'net', latencyMs: r.data.latency_ms } : null;
    }
    const d = parseDeviceTopic(topic);
    if (!d) return null;
    if (d.leaf === 'availability') {
      const r = availability.safeParse(payload);
      return r.success ? { type: 'availability', room: d.room, deviceId: d.deviceId, online: r.data === 'online' } : null;
    }
    if (d.leaf === 'meta') {
      const r = deviceMeta.safeParse(json(payload));
      if (!r.success) return null;
      const m = r.data;
      return { type: 'meta', room: d.room, deviceId: d.deviceId, kind: m.kind, roomName: m.room_name ?? null, name: m.name ?? null, aliases: m.aliases ?? [], risk: m.risk ?? null };
    }
    if (d.leaf === 'state') {
      if (topic === CORE_STATE) {
        const r = coreState.safeParse(json(payload));
        return r.success ? { type: 'core', state: r.data.state, mic: r.data.mic ?? null } : null;
      }
      const r = deviceState.safeParse(json(payload));
      if (!r.success) return null;
      const s = r.data;
      return {
        type: 'state',
        room: d.room,
        deviceId: d.deviceId,
        ...(s.temp_c !== undefined && { tempC: s.temp_c }),
        ...(s.humidity !== undefined && { humidity: s.humidity }),
        ...(s.co2_ppm !== undefined && { co2Ppm: s.co2_ppm }),
        ...(s.presence !== undefined && { presence: s.presence }),
        ...(s.on !== undefined && { on: s.on }),
        ts: t(s.ts, now),
      };
    }
    return null; // `set` is device-bound, not for displays
  } catch {
    return null;
  }
}
