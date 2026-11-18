import { MockSource } from './mock-source';
import { MqttSource } from './mqtt-source';
import type { VegaDataSource } from './types';

export interface DataEnv {
  VITE_DATA_SOURCE?: string;
  VITE_MQTT_URL?: string;
  VITE_ROOM?: string;
}

/** `mock` (default, "SIM") or `mqtt`. Can also be forced with `?source=mqtt&mqtt=ws://host:9001`. */
export function createDataSource(env: DataEnv = import.meta.env, search = typeof location === 'undefined' ? '' : location.search): VegaDataSource {
  const q = new URLSearchParams(search);
  const kind = q.get('source') ?? env.VITE_DATA_SOURCE ?? 'mock';
  if (kind === 'mqtt') {
    const url = q.get('mqtt') ?? env.VITE_MQTT_URL ?? 'ws://localhost:9001';
    return new MqttSource({ url, ...(env.VITE_ROOM ? { primaryRoom: env.VITE_ROOM } : {}) });
  }
  return new MockSource();
}
