/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'mqtt';
  readonly VITE_MQTT_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
