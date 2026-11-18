import type { HistoryEntry, Snapshot, VegaDataSource } from './types';
import { parseMessage } from './parse';
import { applyUpdate } from './reduce';
import { MiniMqttClient } from './minimqtt';

export const SUBSCRIPTIONS = [
  'vega/+/+/state',
  'vega/+/+/meta',
  'vega/+/+/availability',
  'vega/system/events',
] as const;
export const COMMAND_TOPIC = 'vega/system/command';

/** The small slice of the mqtt.js client API we use; lets tests inject a fake. */
export interface MqttLikeClient {
  on(event: 'connect' | 'reconnect' | 'close' | 'offline', cb: () => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'message', cb: (topic: string, payload: Uint8Array) => void): unknown;
  subscribe(topics: readonly string[]): unknown;
  publish(topic: string, payload: string): unknown;
  end(force?: boolean): unknown;
}
export type ClientFactory = (url: string) => Promise<MqttLikeClient>;

const defaultFactory: ClientFactory = async (url) =>
  new MiniMqttClient(url, { clientId: `vega-ui-${Math.random().toString(16).slice(2, 10)}` });

export function emptySnapshot(): Snapshot {
  return {
    sourceKind: 'mqtt',
    isMock: false,
    connection: 'connecting',
    env: null,
    roomNames: {},
    devices: [],
    ci: null,
    next: null,
    co2: null,
    research: null,
    core: 'idle',
    history: [],
  };
}

export interface MqttOptions {
  url: string;
  factory?: ClientFactory;
  now?: () => number;
}

export class MqttSource implements VegaDataSource {
  readonly kind = 'mqtt' as const;
  private snap: Snapshot = emptySnapshot();
  private listeners = new Set<(s: Snapshot) => void>();
  private client: MqttLikeClient | null = null;
  private connected = false;
  private everConnected = false;
  private stopped = false;
  private readonly factory: ClientFactory;
  private readonly now: () => number;
  private seq = 0;
  private readonly decoder = new TextDecoder();

  constructor(private readonly opts: MqttOptions) {
    this.factory = opts.factory ?? defaultFactory;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.client || this.stopped) return;
    void this.factory(this.opts.url)
      .then((client) => {
        if (this.stopped) {
          client.end(true);
          return;
        }
        this.client = client;
        client.on('connect', () => {
          this.connected = true;
          this.everConnected = true;
          client.subscribe(SUBSCRIPTIONS);
          client.subscribe(['vega/desk/core/state']);
          this.setConnection('connected');
        });
        // While retrying after a drop we keep saying "disconnected" instead of flapping.
        client.on('reconnect', () => {
          if (!this.everConnected) this.setConnection('connecting');
        });
        const down = () => {
          this.connected = false;
          this.setConnection('disconnected');
        };
        client.on('close', down);
        client.on('offline', down);
        client.on('error', () => {
          /* mqtt.js keeps retrying; the 'close' event updates the UI */
        });
        client.on('message', (topic, payload) => this.handle(topic, this.decoder.decode(payload)));
      })
      .catch(() => this.setConnection('disconnected'));
  }

  stop(): void {
    this.stopped = true;
    this.client?.end(true);
    this.client = null;
    this.connected = false;
  }

  getSnapshot(): Snapshot {
    return this.snap;
  }

  subscribe(listener: (s: Snapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snap);
    return () => this.listeners.delete(listener);
  }

  sendCommand(text: string): HistoryEntry | null {
    const clean = text.trim();
    if (!clean) return null;
    const ts = this.now();
    const id = `UI-${ts.toString(36)}-${this.seq++}`;
    const sent = this.connected && this.client !== null;
    if (sent) {
      this.client?.publish(COMMAND_TOPIC, JSON.stringify({ v: 1, id, text: clean, ts: new Date(ts).toISOString() }));
    }
    const entry: HistoryEntry = {
      id,
      ts,
      text: clean,
      result: sent ? 'Đã gửi, đang chờ phản hồi' : 'Chưa gửi được: mất kết nối',
      session: null,
    };
    this.update({ ...this.snap, history: [entry, ...this.snap.history] });
    return entry;
  }

  /** Exposed for tests. */
  handle(topic: string, payload: string): void {
    const u = parseMessage(topic, payload, this.now());
    if (u) this.update(applyUpdate(this.snap, u));
  }

  private setConnection(c: Snapshot['connection']): void {
    if (this.snap.connection !== c) this.update({ ...this.snap, connection: c });
  }

  private update(s: Snapshot): void {
    this.snap = s;
    for (const l of this.listeners) l(s);
  }
}
