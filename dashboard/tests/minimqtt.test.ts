import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCONNECT, MiniMqttClient, PINGREQ, PacketParser, encodeConnect, encodePublish, encodeSubscribe } from '../src/data/minimqtt';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('packet encoding (MQTT 3.1.1)', () => {
  it('CONNECT', () => {
    expect(hex(encodeConnect('c1', 30))).toBe('10 0e 00 04 4d 51 54 54 04 02 00 1e 00 02 63 31');
  });
  it('SUBSCRIBE with QoS 0', () => {
    expect(hex(encodeSubscribe(1, ['a/b']))).toBe('82 08 00 01 00 03 61 2f 62 00');
  });
  it('PUBLISH QoS 0', () => {
    expect(hex(encodePublish('t', 'hi'))).toBe('30 05 00 01 74 68 69');
  });
  it('PINGREQ / DISCONNECT', () => {
    expect(hex(PINGREQ)).toBe('c0 00');
    expect(hex(DISCONNECT)).toBe('e0 00');
  });
  it('multi-byte remaining length', () => {
    const big = encodePublish('t', 'x'.repeat(200));
    expect(big[1]).toBe(0xcb); // 203 = 0xcb 0x01
    expect(big[2]).toBe(0x01);
    const [p] = new PacketParser().push(big);
    expect(p).toMatchObject({ type: 'publish', topic: 't' });
    expect(p && p.type === 'publish' ? p.payload.length : 0).toBe(200);
  });
});

describe('PacketParser', () => {
  it('parses CONNACK', () => {
    expect(new PacketParser().push(Uint8Array.of(0x20, 2, 0, 0))).toEqual([{ type: 'connack', code: 0 }]);
    expect(new PacketParser().push(Uint8Array.of(0x20, 2, 0, 5))).toEqual([{ type: 'connack', code: 5 }]);
  });
  it('re-assembles a PUBLISH split across frames and splits merged frames', () => {
    const a = encodePublish('vega/x/y/state', '{"v":1}');
    const b = encodePublish('vega/x/y/meta', '{"v":1}');
    const all = new Uint8Array([...a, ...b]);
    const parser = new PacketParser();
    expect(parser.push(all.slice(0, 5))).toEqual([]);
    const out = parser.push(all.slice(5));
    expect(out.map((p) => (p.type === 'publish' ? p.topic : p.type))).toEqual(['vega/x/y/state', 'vega/x/y/meta']);
  });
  it('reads the packet id of QoS 1 publishes', () => {
    const body = Uint8Array.of(0x32, 6, 0, 1, 0x74, 0, 9, 0x41);
    const [p] = new PacketParser().push(body);
    expect(p).toMatchObject({ type: 'publish', topic: 't', qos: 1, id: 9 });
  });
  it('returns "other" for SUBACK / PINGRESP', () => {
    expect(new PacketParser().push(Uint8Array.of(0x90, 3, 0, 1, 0))).toEqual([{ type: 'other', code: 9 }]);
    expect(new PacketParser().push(Uint8Array.of(0xd0, 0))).toEqual([{ type: 'other', code: 13 }]);
  });
});

class FakeWS {
  static instances: FakeWS[] = [];
  binaryType = '';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readyState = 0;
  constructor(public url: string, public protocol: string) { FakeWS.instances.push(this); }
  send(d: Uint8Array) { this.sent.push(d); }
  close() { this.closed = true; this.onclose?.(); }
  serve(bytes: Uint8Array) { this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); }
}
const fakeCtor = FakeWS as unknown as typeof WebSocket;
const dec = new TextDecoder();

describe('MiniMqttClient', () => {
  beforeEach(() => { FakeWS.instances = []; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('connects with the mqtt subprotocol, subscribes, receives, publishes', () => {
    const c = new MiniMqttClient('ws://h:9001', { clientId: 'id', WebSocketImpl: fakeCtor });
    const ws = FakeWS.instances[0]!;
    expect(ws.protocol).toBe('mqtt');
    const ev: string[] = [];
    c.on('connect', () => ev.push('connect'));
    c.on('message', (t, p) => ev.push(`${t}=${dec.decode(p)}`));
    ws.onopen?.();
    expect(ws.sent[0]![0]).toBe(0x10);
    ws.serve(Uint8Array.of(0x20, 2, 0, 0));
    expect(ev).toEqual(['connect']);
    c.subscribe(['vega/+/+/state']);
    expect(ws.sent[1]![0]).toBe(0x82);
    ws.serve(encodePublish('vega/a/b/state', '{"v":1}'));
    expect(ev[1]).toBe('vega/a/b/state={"v":1}');
    c.publish('vega/system/command', 'x');
    expect(ws.sent[2]![0]).toBe(0x30);
  });

  it('does not publish or subscribe before CONNACK', () => {
    const c = new MiniMqttClient('ws://h', { clientId: 'id', WebSocketImpl: fakeCtor });
    const ws = FakeWS.instances[0]!;
    ws.onopen?.();
    c.publish('t', 'x');
    c.subscribe(['t']);
    expect(ws.sent).toHaveLength(1); // CONNECT only
  });

  it('sends keepalive pings', () => {
    new MiniMqttClient('ws://h', { clientId: 'id', keepaliveS: 30, WebSocketImpl: fakeCtor });
    const ws = FakeWS.instances[0]!;
    ws.onopen?.();
    ws.serve(Uint8Array.of(0x20, 2, 0, 0));
    vi.advanceTimersByTime(15_000);
    expect(hex(ws.sent.at(-1)!)).toBe('c0 00');
  });

  it('reconnects after the broker goes away and comes back', () => {
    const c = new MiniMqttClient('ws://h', { clientId: 'id', reconnectMs: 2000, WebSocketImpl: fakeCtor });
    const ev: string[] = [];
    (['connect', 'reconnect', 'close', 'offline'] as const).forEach((e) => c.on(e, () => ev.push(e)));
    const ws1 = FakeWS.instances[0]!;
    ws1.onopen?.();
    ws1.serve(Uint8Array.of(0x20, 2, 0, 0));
    ws1.onclose?.(); // broker stopped
    expect(ev).toEqual(['connect', 'offline', 'close']);
    vi.advanceTimersByTime(1999);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ev.at(-1)).toBe('reconnect');
    expect(FakeWS.instances).toHaveLength(2);
    // broker still down: connect fails, retries again
    FakeWS.instances[1]!.onclose?.();
    vi.advanceTimersByTime(2000);
    expect(FakeWS.instances).toHaveLength(3);
    // broker is back
    const ws3 = FakeWS.instances[2]!;
    ws3.onopen?.();
    ws3.serve(Uint8Array.of(0x20, 2, 0, 0));
    expect(ev.at(-1)).toBe('connect');
  });

  it('closes a socket that never answers CONNACK', () => {
    new MiniMqttClient('ws://h', { clientId: 'id', connectTimeoutMs: 4000, WebSocketImpl: fakeCtor });
    const ws = FakeWS.instances[0]!;
    ws.onopen?.();
    vi.advanceTimersByTime(4000);
    expect(ws.closed).toBe(true);
  });

  it('rejects a refused CONNACK with an error and no connect event', () => {
    const c = new MiniMqttClient('ws://h', { clientId: 'id', WebSocketImpl: fakeCtor });
    const ev: string[] = [];
    c.on('connect', () => ev.push('connect'));
    c.on('error', (e) => ev.push(e.message));
    const ws = FakeWS.instances[0]!;
    ws.onopen?.();
    ws.serve(Uint8Array.of(0x20, 2, 0, 5));
    expect(ev).toEqual(['connack refused: 5']);
  });

  it('treats an error before open as a failed connect even if no close event follows (Node/undici)', () => {
    const c = new MiniMqttClient('ws://h', { clientId: 'id', reconnectMs: 1000, WebSocketImpl: fakeCtor });
    const ev: string[] = [];
    (['close', 'reconnect', 'offline'] as const).forEach((e) => c.on(e, () => ev.push(e)));
    c.on('error', () => ev.push('error'));
    FakeWS.instances[0]!.onerror?.();
    expect(ev).toEqual(['error', 'close']);
    vi.advanceTimersByTime(1000);
    expect(ev.at(-1)).toBe('reconnect');
    expect(FakeWS.instances).toHaveLength(2);
    FakeWS.instances[0]!.onclose?.(); // a late close from the first socket must not double-count
    expect(ev.filter((e) => e === 'close')).toHaveLength(1);
  });

  it('end() stops retrying', () => {
    const c = new MiniMqttClient('ws://h', { clientId: 'id', WebSocketImpl: fakeCtor });
    FakeWS.instances[0]!.onclose?.();
    c.end();
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.instances).toHaveLength(1);
  });
});
