import type { VegaDataSource } from './types';
import { MockSource } from './mock';
import { MqttSource } from './mqtt';

export function createDataSource(env: { VITE_DATA_SOURCE?: string; VITE_MQTT_URL?: string } = import.meta.env): VegaDataSource {
  if (env.VITE_DATA_SOURCE === 'mqtt') {
    return new MqttSource({ url: env.VITE_MQTT_URL || 'ws://localhost:9001' });
  }
  return new MockSource();
}
