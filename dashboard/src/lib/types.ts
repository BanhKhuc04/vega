export type Mode = 'idle' | 'research' | 'focus' | 'history';
export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'alert' | 'sleep';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type DeviceKind = 'esp8266' | 'esp32-s3' | 'unknown';
export type Tone = 'good' | 'warn' | 'plain';

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
  kind: DeviceKind;
  online: boolean;
}

export interface CiStatus {
  repo: string;
  failed: number;
  ts: number;
}

export interface NextEvent {
  title: string;
  at: number; // epoch ms
}

export interface Co2Series {
  room: string;
  values: number[]; // 24 hourly values
  thresholdPpm: number;
  maxPpm: number;
}

export interface ResearchStep {
  label: string;
  state: 'done' | 'active' | 'todo';
  detail?: string;
  progress?: number; // 0..1, only for the active step
}

export interface ResearchSession {
  id: string;
  title: string;
  stepNo: number;
  stepCount: number;
  phase: string;
  sources: number;
  sourcesDesc: string;
  ref: string;
  steps: ResearchStep[];
  sourceCaption: string;
  compare: {
    title: string;
    columns: string[];
    rows: { label: string; cells: { text: string; tone: Tone }[] }[];
  };
  note: string;
  noteRefs: string;
}

export interface HistoryEntry {
  id: string;
  ts: number;
  text: string;
  result: string;
  session: ResearchSession | null;
}

export interface Snapshot {
  sourceKind: 'mock' | 'mqtt';
  /** True while the shown data is sample data. Must always be labelled in the UI. */
  isMock: boolean;
  connection: ConnectionStatus;
  env: RoomEnv | null;
  devices: Device[];
  ci: CiStatus | null;
  next: NextEvent | null;
  co2: Co2Series | null;
  research: ResearchSession | null;
  core: CoreState;
  history: HistoryEntry[];
}

export interface VegaDataSource {
  readonly kind: 'mock' | 'mqtt';
  start(): void;
  stop(): void;
  getSnapshot(): Snapshot;
  subscribe(listener: (s: Snapshot) => void): () => void;
  /** Send a command typed in the command bar. Returns the history entry created for it. */
  sendCommand(text: string): HistoryEntry | null;
}

export const CORE_STATES: readonly CoreState[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'alert',
  'sleep',
];
export const DEVICE_KINDS: readonly DeviceKind[] = ['esp8266', 'esp32-s3', 'unknown'];
