import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { CAMERA_STATE, OWNTRACKS, PAYLOAD_VERSION, SYSTEM_BACKUP, SYSTEM_HEALTH, SYSTEM_PRESENCE, cameraState, SYSTEM_COMMAND, SYSTEM_PI, UI_SCENE, piStats, deviceTopic, eventTopic, presenceState, relaySet, sceneMessage, systemEvent } from '@vega/contract';
import type { SceneMessage, SourceRef } from '@vega/contract';

/** A scene as the brain writes it: the envelope fields `v` and `ts` are added on publish. */
export type SceneOut = SceneMessage extends infer S ? (S extends SceneMessage ? Omit<S, 'v' | 'ts'> : never) : never;

/** Everything the brain sends. Every payload is built and validated with @vega/contract before it leaves. */
export interface Bus {
  scene(s: SceneOut): void;
  /** The answer to a command; `speak` is read aloud instead of the text, `sources` are the links it cites. */
  result(id: string, text: string, extra?: { speak?: string; sources?: SourceRef[] }): void;
  setDevice(room: string, id: string, on: boolean): void;
  /** Stats of the machine the brain runs on (the Pi). */
  pi(s: { cpuPct: number; memPct: number; tempC: number | null; uptimeS: number }): void;
  /** CI state for the screen's CI/CD row (retained). */
  ci(repo: string, failed: number): void;
  /** The next calendar event, for the Idle screen (retained). */
  nextEvent(title: string, detail: string | undefined, at: number): void;
  /** Something VEGA says on its own: shown in the chat and read aloud (not retained). */
  announce(text: string): void;
  /** Today's AI spending (retained, for the screen). */
  usage(u: { day: string; spentUsd: number; budgetUsd: number; calls: number; tokensIn: number; tokensOut: number }): void;
  /** Is the Vision camera plugged in (retained, M7). */
  camera(present: boolean): void;
  /** The owner home or away, from the phone (retained, M8). */
  presence(home: boolean): void;
}

/** Topics the brain listens to. */
export const BRAIN_SUBSCRIPTIONS = ['vega/+/+/meta', 'vega/+/+/state', 'vega/+/+/availability', SYSTEM_PI, SYSTEM_COMMAND, SYSTEM_HEALTH, SYSTEM_BACKUP, OWNTRACKS];

export function mqttBus(client: MqttClient, now: () => number = Date.now): Bus {
  const v = PAYLOAD_VERSION;
  return {
    scene(s) {
      const msg = sceneMessage.parse({ v, ts: new Date(now()).toISOString(), ...s });
      client.publish(UI_SCENE, JSON.stringify(msg), { retain: true });
    },
    result(id, text, extra = {}) {
      const msg = systemEvent.parse({
        v,
        type: 'command_result',
        id,
        result: text.slice(0, 2000),
        ...(extra.speak && { speak: extra.speak.slice(0, 300) }),
        ...(extra.sources?.length && { sources: extra.sources.slice(0, 8) }),
      });
      client.publish(eventTopic('command_result'), JSON.stringify(msg), { retain: true });
    },
    setDevice(room, id, on) {
      client.publish(deviceTopic(room, id, 'set'), JSON.stringify(relaySet.parse({ v, on })));
    },
    pi(s) {
      const msg = piStats.parse({ v, ts: new Date(now()).toISOString(), cpu_pct: s.cpuPct, mem_pct: s.memPct, uptime_s: s.uptimeS, ...(s.tempC !== null && { temp_c: s.tempC }) });
      client.publish(SYSTEM_PI, JSON.stringify(msg), { retain: true });
    },
    ci(repo, failed) {
      const msg = systemEvent.parse({ v, type: 'ci', repo, failed, ts: new Date(now()).toISOString() });
      client.publish(eventTopic('ci'), JSON.stringify(msg), { retain: true });
    },
    nextEvent(title, detail, at) {
      const msg = systemEvent.parse({ v, type: 'next_event', title, ...(detail && { detail }), at: new Date(at).toISOString() });
      client.publish(eventTopic('next_event'), JSON.stringify(msg), { retain: true });
    },
    announce(text) {
      const msg = systemEvent.parse({ v, type: 'announce', text: text.slice(0, 300), ts: new Date(now()).toISOString() });
      client.publish(eventTopic('announce'), JSON.stringify(msg));
    },
    usage(u) {
      const msg = systemEvent.parse({ v, type: 'llm_usage', day: u.day, spent_usd: u.spentUsd, budget_usd: u.budgetUsd, calls: u.calls, tokens_in: u.tokensIn, tokens_out: u.tokensOut });
      client.publish(eventTopic('llm_usage'), JSON.stringify(msg), { retain: true });
    },
    camera(present) {
      client.publish(CAMERA_STATE, JSON.stringify(cameraState.parse({ v, camera: present ? 'on' : 'missing' })), { retain: true });
    },
    presence(home) {
      client.publish(SYSTEM_PRESENCE, JSON.stringify(presenceState.parse({ v, ts: new Date(now()).toISOString(), state: home ? 'home' : 'away' })), { retain: true });
    },
  };
}

export function connect(url: string, opts: { username?: string; password?: string; clientId?: string } = {}): MqttClient {
  return mqtt.connect(url, {
    clientId: opts.clientId ?? `vega-brain-${process.pid}-${Math.random().toString(16).slice(2, 6)}`,
    username: opts.username,
    password: opts.password,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  });
}
