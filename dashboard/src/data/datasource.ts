import { MockSource } from './mock-source';
import { MqttSource } from './mqtt-source';
import type { VegaDataSource } from './types';

/** Runtime settings, written by the nginx container into /config.js (see dashboard/docker/40-vega-config.sh). */
export interface RuntimeConfig {
  source?: string;
  mqttUrl?: string;
  username?: string;
  password?: string;
  room?: string;
}
declare global {
  interface Window {
    __VEGA__?: RuntimeConfig;
  }
}

export interface DataEnv {
  VITE_DATA_SOURCE?: string;
  VITE_MQTT_URL?: string;
  VITE_ROOM?: string;
}

/**
 * Picks the data source. Precedence: URL (`?source=mqtt&mqtt=ws://host:9001`) > /config.js > build-time env > SIM.
 * Default broker URL is the WebSocket listener on the host that served the page.
 */
export function createDataSource(
  env: DataEnv = import.meta.env,
  search = typeof location === 'undefined' ? '' : location.search,
  cfg: RuntimeConfig = (typeof window === 'undefined' ? undefined : window.__VEGA__) ?? {},
  host = typeof location === 'undefined' ? 'localhost' : location.hostname || 'localhost',
): VegaDataSource {
  const q = new URLSearchParams(search);
  const kind = q.get('source') || cfg.source || env.VITE_DATA_SOURCE || 'mock';
  if (kind !== 'mqtt') return new MockSource();
  const url = q.get('mqtt') || cfg.mqttUrl || env.VITE_MQTT_URL || `ws://${host}:9001`;
  const room = cfg.room || env.VITE_ROOM;
  return new MqttSource({
    url,
    ...(room && { primaryRoom: room }),
    ...(cfg.username && { username: cfg.username }),
    ...(cfg.password !== undefined && { password: cfg.password }),
  });
}
