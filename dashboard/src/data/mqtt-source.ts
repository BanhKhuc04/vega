import { DASHBOARD_SUBSCRIPTIONS, SYSTEM_COMMAND, PAYLOAD_VERSION, parseMessage } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { MiniMqttClient } from './minimqtt';
import { applyUpdate } from './reduce';
import { emptySnapshot } from './sample';
import type { ConnState, Snapshot, VegaDataSource } from './types';

/** The small slice of an MQTT client API we use; lets tests inject a fake. */
export interface MqttLikeClient {
  on(event: 'connect' | 'reconnect' | 'close' | 'offline', cb: () => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: 'message', cb: (topic: string, payload: Uint8Array) => void): unknown;
  subscribe(topics: readonly string[]): unknown;
  publish(topic: string, payload: string): unknown;
  end(force?: boolean): unknown;
}
export type ClientFactory = (url: string) => Promise<MqttLikeClient>;

export interface Credentials {
  username?: string;
  password?: string;
}
const defaultFactory = (cred: Credentials): ClientFactory => async (url) =>
  new MiniMqttClient(url, { clientId: `vega-ui-${Math.random().toString(16).slice(2, 10)}`, ...cred });

export interface MqttOptions {
  url: string;
  primaryRoom?: string;
  username?: string;
  password?: string;
  factory?: ClientFactory;
  now?: () => number;
  warn?: (msg: string) => void;
}

export class MqttSource implements VegaDataSource {
  readonly kind = 'mqtt' as const;
  private snap: Snapshot;
  private listeners = new Set<(s: Snapshot) => void>();
  private sceneListeners = new Set<(s: SceneMessage) => void>();
  private client: MqttLikeClient | null = null;
  private connected = false;
  private everConnected = false;
  private stopped = false;
  private warned = false;
  private seq = 0;
  private readonly factory: ClientFactory;
  private readonly now: () => number;
  private readonly warn: (msg: string) => void;
  private readonly decoder = new TextDecoder();

  constructor(private readonly opts: MqttOptions) {
    this.factory =
      opts.factory ??
      defaultFactory({ ...(opts.username !== undefined && { username: opts.username }), ...(opts.password !== undefined && { password: opts.password }) });
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn ?? ((m) => console.warn(m));
    this.snap = emptySnapshot('mqtt', opts.primaryRoom);
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
          client.subscribe(DASHBOARD_SUBSCRIPTIONS);
          this.setConn('live');
        });
        // While retrying after a drop we keep saying "reconnecting" instead of flapping.
        client.on('reconnect', () => {
          if (!this.everConnected) this.setConn('offline');
        });
        const down = () => {
          this.connected = false;
          this.setConn(this.everConnected ? 'reconnecting' : 'offline');
        };
        client.on('close', down);
        client.on('offline', down);
        client.on('error', () => {
          /* the client keeps retrying; 'close' updates the header */
        });
        client.on('message', (topic, payload) => this.handle(topic, this.decoder.decode(payload)));
      })
      .catch(() => this.setConn('offline'));
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

  onScene(listener: (s: SceneMessage) => void): () => void {
    this.sceneListeners.add(listener);
    return () => this.sceneListeners.delete(listener);
  }

  sendCommand(text: string): boolean {
    const clean = text.trim();
    if (!clean || !this.connected || !this.client) return false;
    const ts = this.now();
    const id = `UI-${ts.toString(36)}-${this.seq++}`;
    this.client.publish(SYSTEM_COMMAND, JSON.stringify({ v: PAYLOAD_VERSION, id, text: clean, ts: new Date(ts).toISOString() }));
    return true;
  }

  /** Exposed for tests. */
  handle(topic: string, payload: string): void {
    const u = parseMessage(topic, payload, this.now());
    if (!u) return;
    if (u.type === 'scene') {
      this.warned = false;
      for (const l of this.sceneListeners) l(u.scene);
      return;
    }
    if (u.type === 'sceneInvalid') {
      if (!this.warned) {
        this.warned = true;
        this.warn(`[vega] ignored invalid scene on vega/ui/scene: ${u.error}`);
      }
      return;
    }
    this.update(applyUpdate(this.snap, u));
  }

  private setConn(c: ConnState): void {
    if (this.snap.conn !== c) this.update({ ...this.snap, conn: c });
  }

  private update(s: Snapshot): void {
    this.snap = s;
    for (const l of this.listeners) l(s);
  }
}
