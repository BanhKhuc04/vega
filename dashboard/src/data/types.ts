import type { CoreStateMsg, DeviceKind, SceneMessage, SourceRef } from '@vega/contract';

export type CoreState = CoreStateMsg['state'];
/** Extra parts of an answer: what to read aloud (null = the text itself) and the sources it cites. */
export interface ResultExtra {
  speak: string | null;
  sources: SourceRef[];
}
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
  /** The brain's AI spending today (cost ledger). */
  ai: { day: string; spentUsd: number; budgetUsd: number; calls: number } | null;
  next: { title: string; detail: string | null; at: number } | null;
  co2Series: { room: string; values: number[]; thresholdPpm: number; maxPpm: number } | null;
  pi: { cpuPct: number | null; tempC: number | null; memPct: number | null; uptimeS: number | null } | null;
  net: { latencyMs: number } | null;
  core: CoreState;
  /** The voice agent's microphone (M5.2); null = no agent has reported. */
  mic: 'on' | 'off' | 'missing' | null;
}

export interface VegaDataSource {
  readonly kind: 'mock' | 'mqtt';
  start(): void;
  stop(): void;
  getSnapshot(): Snapshot;
  subscribe(listener: (s: Snapshot) => void): () => void;
  /** Scenes pushed by the brain on `vega/ui/scene` (already validated). */
  onScene(listener: (s: SceneMessage) => void): () => void;
  /** Answers of the brain (`command_result`): command id, full text, and what to read aloud / the cited sources. */
  onResult(listener: (id: string, text: string, extra: ResultExtra) => void): () => void;
  /** What the brain says on its own (a reminder, the morning briefing). */
  onAnnounce(listener: (text: string) => void): () => void;
  /** A command the voice agent heard (`via: "voice"`): shown in the chat, read aloud by the agent, not here. */
  onVoiceCommand(listener: (id: string, text: string) => void): () => void;
  /** Publishes a typed command. Returns its id, or null if it could not be sent. */
  sendCommand(text: string): string | null;
}
