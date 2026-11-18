import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { PAYLOAD_VERSION, SYSTEM_COMMAND, UI_SCENE, deviceTopic, eventTopic, relaySet, sceneMessage, systemEvent } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';

/** A scene as the brain writes it: the envelope fields `v` and `ts` are added on publish. */
export type SceneOut = SceneMessage extends infer S ? (S extends SceneMessage ? Omit<S, 'v' | 'ts'> : never) : never;

/** Everything the brain sends. Every payload is built and validated with @vega/contract before it leaves. */
export interface Bus {
  scene(s: SceneOut): void;
  result(id: string, text: string): void;
  setDevice(room: string, id: string, on: boolean): void;
}

/** Topics the brain listens to. */
export const BRAIN_SUBSCRIPTIONS = ['vega/+/+/meta', 'vega/+/+/state', 'vega/+/+/availability', SYSTEM_COMMAND];

export function mqttBus(client: MqttClient, now: () => number = Date.now): Bus {
  const v = PAYLOAD_VERSION;
  return {
    scene(s) {
      const msg = sceneMessage.parse({ v, ts: new Date(now()).toISOString(), ...s });
      client.publish(UI_SCENE, JSON.stringify(msg), { retain: true });
    },
    result(id, text) {
      const msg = systemEvent.parse({ v, type: 'command_result', id, result: text.slice(0, 500) });
      client.publish(eventTopic('command_result'), JSON.stringify(msg), { retain: true });
    },
    setDevice(room, id, on) {
      client.publish(deviceTopic(room, id, 'set'), JSON.stringify(relaySet.parse({ v, on })));
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
