/**
 * Minimal MQTT 3.1.1 client over WebSocket (QoS 0 publish/subscribe only).
 *
 * Why not mqtt.js: its browser build is ~100 KB gzip, which alone blows the 120 KB JS budget
 * of Decision Brief 0001 (the rest of the app is ~32 KB). The UI only needs CONNECT, SUBSCRIBE,
 * PUBLISH (QoS 0), PINGREQ and automatic reconnect, so this file implements just that.
 * The `MqttLikeClient` interface keeps the swap to mqtt.js a one-line change if that ever matters.
 */
import type { MqttLikeClient } from './mqtt';

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8(s: string): Uint8Array {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 0xff;
  out.set(b, 2);
  return out;
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(first: number, ...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const head = [first, ...remainingLength(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function encodeConnect(clientId: string, keepaliveS: number): Uint8Array {
  // protocol "MQTT" level 4, clean session, keepalive
  return packet(0x10, utf8('MQTT'), Uint8Array.of(4, 0x02, keepaliveS >> 8, keepaliveS & 0xff), utf8(clientId));
}

export function encodeSubscribe(packetId: number, topics: readonly string[]): Uint8Array {
  return packet(0x82, Uint8Array.of(packetId >> 8, packetId & 0xff), ...topics.map((t) => packet2(t)));
}
const packet2 = (t: string): Uint8Array => {
  const u = utf8(t);
  const out = new Uint8Array(u.length + 1);
  out.set(u, 0); // requested QoS 0 is the trailing zero byte
  return out;
};

export function encodePublish(topic: string, payload: string): Uint8Array {
  return packet(0x30, utf8(topic), enc.encode(payload));
}

export const PINGREQ = Uint8Array.of(0xc0, 0x00);
export const DISCONNECT = Uint8Array.of(0xe0, 0x00);

export type Packet =
  | { type: 'connack'; code: number }
  | { type: 'publish'; topic: string; payload: Uint8Array; qos: number; id: number }
  | { type: 'other'; code: number };

/** Re-assembles packets from a byte stream (WebSocket frames may split or merge packets). */
export class PacketParser {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Packet[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const out: Packet[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let len = 0;
      let mult = 1;
      let i = 1;
      let complete = false;
      while (i < this.buf.length && i <= 4) {
        const b = this.buf[i++]!;
        len += (b & 0x7f) * mult;
        mult *= 128;
        if ((b & 0x80) === 0) {
          complete = true;
          break;
        }
      }
      if (!complete || this.buf.length < i + len) break;
      const first = this.buf[0]!;
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      out.push(decode(first, body));
    }
    return out;
  }
}

function decode(first: number, body: Uint8Array): Packet {
  const type = first >> 4;
  if (type === 2) return { type: 'connack', code: body[1] ?? 255 };
  if (type === 3) {
    const qos = (first >> 1) & 3;
    const tl = ((body[0] ?? 0) << 8) | (body[1] ?? 0);
    const topic = dec.decode(body.slice(2, 2 + tl));
    let o = 2 + tl;
    let id = 0;
    if (qos > 0) {
      id = ((body[o] ?? 0) << 8) | (body[o + 1] ?? 0);
      o += 2;
    }
    return { type: 'publish', topic, payload: body.slice(o), qos, id };
  }
  return { type: 'other', code: type };
}

export interface MiniOptions {
  clientId: string;
  keepaliveS?: number;
  reconnectMs?: number;
  connectTimeoutMs?: number;
  /** Injected in tests. */
  WebSocketImpl?: typeof WebSocket;
}

type Handlers = {
  connect: (() => void)[];
  reconnect: (() => void)[];
  close: (() => void)[];
  offline: (() => void)[];
  error: ((e: Error) => void)[];
  message: ((topic: string, payload: Uint8Array) => void)[];
};

export class MiniMqttClient implements MqttLikeClient {
  private ws: WebSocket | null = null;
  private handlers: Handlers = { connect: [], reconnect: [], close: [], offline: [], error: [], message: [] };
  private parser = new PacketParser();
  private connected = false;
  private ended = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private readonly keepalive: number;
  private readonly reconnectMs: number;
  private readonly connectTimeoutMs: number;
  private readonly WS: typeof WebSocket;

  constructor(
    private readonly url: string,
    private readonly opts: MiniOptions,
  ) {
    this.keepalive = opts.keepaliveS ?? 30;
    this.reconnectMs = opts.reconnectMs ?? 2000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 4000;
    this.WS = opts.WebSocketImpl ?? WebSocket;
    this.open();
  }

  on(event: 'connect' | 'reconnect' | 'close' | 'offline', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  on(event: 'message', cb: (topic: string, payload: Uint8Array) => void): this;
  on(event: keyof Handlers, cb: (...a: never[]) => void): this {
    (this.handlers[event] as ((...a: never[]) => void)[]).push(cb);
    return this;
  }

  subscribe(topics: readonly string[]): void {
    if (this.connected) this.send(encodeSubscribe(this.nextId++ & 0xffff || 1, topics));
  }

  publish(topic: string, payload: string): void {
    if (this.connected) this.send(encodePublish(topic, payload));
  }

  end(_force?: boolean): void {
    this.ended = true;
    this.clearTimers();
    if (this.ws) {
      try {
        if (this.connected) this.ws.send(DISCONNECT);
        this.ws.close();
      } catch {
        /* already closed */
      }
    }
    this.ws = null;
    this.connected = false;
  }

  private emit<K extends keyof Handlers>(event: K, ...args: Parameters<Handlers[K][number]>): void {
    for (const h of this.handlers[event] as ((...a: unknown[]) => void)[]) h(...args);
  }

  private send(data: Uint8Array): void {
    try {
      this.ws?.send(data as BufferSource);
    } catch {
      /* socket closing: onclose will handle it */
    }
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.pingTimer = this.retryTimer = this.timeoutTimer = null;
  }

  private open(): void {
    if (this.ended) return;
    let ws: WebSocket;
    try {
      ws = new this.WS(this.url, 'mqtt');
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this.parser = new PacketParser();
    this.timeoutTimer = setTimeout(() => ws.close(), this.connectTimeoutMs);
    ws.onopen = () => this.send(encodeConnect(this.opts.clientId, this.keepalive));
    ws.onmessage = (ev: MessageEvent) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      for (const p of this.parser.push(new Uint8Array(ev.data))) this.onPacket(p);
    };
    ws.onerror = () => this.emit('error', new Error('websocket error'));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.clearTimers();
      this.ws = null;
      if (wasConnected) this.emit('offline');
      this.emit('close');
      this.scheduleRetry();
    };
  }

  private onPacket(p: Packet): void {
    if (p.type === 'connack') {
      if (p.code !== 0) {
        this.emit('error', new Error(`connack refused: ${p.code}`));
        this.ws?.close();
        return;
      }
      if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
      this.connected = true;
      this.pingTimer = setInterval(() => this.send(PINGREQ), (this.keepalive * 1000) / 2);
      this.emit('connect');
    } else if (p.type === 'publish') {
      if (p.qos === 1) this.send(Uint8Array.of(0x40, 2, p.id >> 8, p.id & 0xff));
      this.emit('message', p.topic, p.payload);
    }
  }

  private scheduleRetry(): void {
    if (this.ended) return;
    this.retryTimer = setTimeout(() => {
      this.emit('reconnect');
      this.open();
    }, this.reconnectMs);
  }
}
