import type { CoreStateMsg, DeviceKind, SceneMessage } from '@vega/contract';

export type CoreState = CoreStateMsg['state'];
/** What the header chip shows. */
export type ConnState = 'live' | 'reconnecting' | 'offline' | 'sim';
export type KnownKind = DeviceKind | 'unknown';

export interface RoomEnv {
  room: string;
  roomName: string;
  tempC: number | null;
  humidity: number | null;
  co2Ppm: number | null;
  ts: number;
}

export interface Device {
  id: string; // "<room>/<device_id>"
  kind: KnownKind;
  online: boolean;
}

export interface Snapshot {
  sourceKind: 'mock' | 'mqtt';
  /** Everything shown is simulated (SIM mode). */
  isSample: boolean;
  conn: ConnState;
  /** Room whose readings drive the Idle screen. */
  primaryRoom: string;
  env: RoomEnv | null;
  roomNames: Record<string, string>;
  /** Last 24 CO₂ readings for the sparkline. */
  co2Spark: number[];
  co2Threshold: number;
  presence: boolean | null;
  devices: Device[];
  ci: { repo: string; failed: number; ts: number } | null;
  next: { title: string; detail: string | null; at: number } | null;
  co2Series: { room: string; values: number[]; thresholdPpm: number; maxPpm: number } | null;
  pi: { cpuPct: number | null; tempC: number | null; memPct: number | null; uptimeS: number | null } | null;
  net: { latencyMs: number } | null;
  core: CoreState;
}

export interface VegaDataSource {
  readonly kind: 'mock' | 'mqtt';
  start(): void;
  stop(): void;
  getSnapshot(): Snapshot;
  subscribe(listener: (s: Snapshot) => void): () => void;
  /** Scenes pushed by the brain on `vega/ui/scene` (already validated). */
  onScene(listener: (s: SceneMessage) => void): () => void;
  /** Publishes a typed command. Returns false if it could not be sent. */
  sendCommand(text: string): boolean;
}
