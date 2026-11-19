import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { PAYLOAD_VERSION, SYSTEM_EVENTS, SYSTEM_EVENTS_RETAINED, SYSTEM_NET, SYSTEM_PI, UI_SCENE, deviceTopic, eventTopic, parseMessage, relaySet } from '@vega/contract';
import type { DeviceKind } from '@vega/contract';
import { CO2_BY_HOUR, envAt, hourOf, presenceAt } from './model';

export interface DeviceDef {
  room: string;
  id: string;
  kind: DeviceKind;
  role: 'env' | 'radar' | 'relay' | 'core';
  roomName?: string;
  /** Words the owner uses for it (the brain's device dictionary). */
  aliases?: string[];
  risk?: 'low' | 'high';
}

/** 5 × esp8266 + 1 × esp32-s3, as in the template's "MQTT 6/6" mesh. */
export const DEVICES: readonly DeviceDef[] = [
  { room: 'bedroom', id: 'env', kind: 'esp8266', role: 'env', roomName: 'Bedroom', aliases: ['phòng ngủ', 'bedroom'] },
  { room: 'bedroom', id: 'radar', kind: 'esp8266', role: 'radar', roomName: 'Bedroom' },
  { room: 'livingroom', id: 'light', kind: 'esp8266', role: 'relay', roomName: 'Living room', aliases: ['đèn', 'đèn phòng khách', 'light', 'lamp'], risk: 'low' },
  // a high-power socket (kettle, heater): the brain asks for confirmation before switching it
  { room: 'kitchen', id: 'plug', kind: 'esp8266', role: 'relay', roomName: 'Kitchen', aliases: ['ổ cắm', 'ổ cắm bếp', 'plug', 'socket'], risk: 'high' },
  { room: 'balcony', id: 'env', kind: 'esp8266', role: 'env', roomName: 'Balcony', aliases: ['ban công', 'balcony', 'ngoài trời', 'outside'] },
  { room: 'desk', id: 'core', kind: 'esp32-s3', role: 'core', roomName: 'Desk' },
];
export const deviceKey = (d: Pick<DeviceDef, 'room' | 'id'>) => `${d.room}/${d.id}`;

export interface SimOptions {
  /** `mqtt://host:1883` or `ws://host:9001`. */
  url: string;
  username?: string;
  password?: string;
  intervalMs?: number;
  piIntervalMs?: number;
  now?: () => Date;
  rng?: () => number;
  /** `none`: publish nothing; `pass`/`fail`: the CI state to start from (default `pass`). */
  initialCi?: 'none' | 'pass' | 'fail';
  /** The temporary CI -> alert/success scene rule (default on). Off when the brain watches real CI (M3). */
  sceneRule?: boolean;
  log?: (msg: string) => void;
}

export interface Sim {
  deviceKeys: string[];
  /** Drops a device's connection abruptly, so the broker publishes its Last Will (`offline`). */
  killDevice(key: string): Promise<void>;
  reviveDevice(key: string): Promise<void>;
  /** Publishes a CI event; the scene rule reacts to it like it would to a real one. */
  setCi(failed: number, repo?: string): void;
  stop(): Promise<void>;
}

const v = PAYLOAD_VERSION;

function connect(opts: SimOptions, clientId: string, will?: { topic: string; payload: string }): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const c = mqtt.connect(opts.url, {
      clientId,
      username: opts.username,
      password: opts.password,
      reconnectPeriod: 1000,
      connectTimeout: 4000,
      ...(will && { will: { topic: will.topic, payload: Buffer.from(will.payload), retain: true, qos: 0 } }),
    });
    const onErr = (e: Error) => reject(e);
    c.once('error', onErr);
    c.once('connect', () => {
      c.off('error', onErr);
      c.on('error', () => {});
      resolve(c);
    });
  });
}

export function nextLocalAt(hh: number, mm: number, now: Date): Date {
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** Starts the virtual devices and the system publisher against a broker. */
export async function runSim(opts: SimOptions): Promise<Sim> {
  const now = opts.now ?? (() => new Date());
  const rng = opts.rng ?? Math.random;
  const log = opts.log ?? (() => {});
  const interval = opts.intervalMs ?? 2000;
  const tag = `${process.pid}-${Math.random().toString(16).slice(2, 6)}`;
  const timers: ReturnType<typeof setInterval>[] = [];
  const clients = new Map<string, MqttClient>();
  const relays = new Map<string, boolean>();
  let stopped = false;

  const pub = (c: MqttClient, topic: string, payload: string | object, retain = true) =>
    c.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain });

  async function bringUp(d: DeviceDef): Promise<void> {
    const key = deviceKey(d);
    const avail = deviceTopic(d.room, d.id, 'availability');
    const c = await connect(opts, `vega-sim-${tag}-${d.room}-${d.id}`, { topic: avail, payload: 'offline' });
    clients.set(key, c);
    pub(c, deviceTopic(d.room, d.id, 'meta'), { v, kind: d.kind, ...(d.roomName && { room_name: d.roomName }), ...(d.aliases && { aliases: d.aliases }), ...(d.risk && { risk: d.risk }) });
    pub(c, avail, 'online');
    if (d.role === 'relay') {
      const set = deviceTopic(d.room, d.id, 'set');
      c.subscribe(set);
      relays.set(key, relays.get(key) ?? false);
      c.on('message', (topic, payload) => {
        if (topic !== set) return;
        try {
          const r = relaySet.safeParse(JSON.parse(payload.toString()));
          if (!r.success) return log(`[sim] ${key}: ignored bad set payload`);
          relays.set(key, r.data.on);
          pub(c, deviceTopic(d.room, d.id, 'state'), { v, ts: now().toISOString(), on: r.data.on });
          log(`[sim] ${key} -> ${r.data.on ? 'on' : 'off'}`);
        } catch {
          log(`[sim] ${key}: ignored malformed set payload`);
        }
      });
    }
    if (d.role === 'core') pub(c, deviceTopic(d.room, d.id, 'state'), { v, state: 'idle' });
    publishState(d);
  }

  function publishState(d: DeviceDef): void {
    const c = clients.get(deviceKey(d));
    if (!c || !c.connected) return;
    const t = now();
    const topic = deviceTopic(d.room, d.id, 'state');
    if (d.role === 'env') {
      const e = envAt(t, rng);
      // the balcony is a different place: cooler, fresher air
      const env = d.room === 'balcony' ? { temp_c: e.temp_c - 3, humidity: e.humidity - 8, co2_ppm: 430 + Math.round(rng() * 30) } : e;
      pub(c, topic, { v, ts: t.toISOString(), ...env });
    } else if (d.role === 'radar') {
      pub(c, topic, { v, ts: t.toISOString(), presence: presenceAt(hourOf(t)) });
    } else if (d.role === 'relay') {
      pub(c, topic, { v, ts: t.toISOString(), on: relays.get(deviceKey(d)) ?? false });
    }
  }

  for (const d of DEVICES) await bringUp(d);

  // --- system publisher + scene rule ---
  const sys = await connect(opts, `vega-sim-${tag}-system`);
  const t0 = now();
  let lastFailed = opts.initialCi === 'fail' ? 1 : 0;
  const ciPayload = (failed: number, repo: string) => JSON.stringify({ v, type: 'ci', repo, failed, ts: now().toISOString() });
  const pubCi = (failed: number, repo: string) => pub(sys, eventTopic('ci'), ciPayload(failed, repo));
  let startupCi = opts.initialCi === 'none' ? null : ciPayload(lastFailed, 'firmware-esp');
  if (startupCi) pub(sys, eventTopic('ci'), startupCi);
  pub(sys, eventTopic('next_event'), { v, type: 'next_event', title: 'lab report', detail: 'computer networks', at: nextLocalAt(16, 30, t0).toISOString() });
  pub(sys, eventTopic('co2_series'), { v, type: 'co2_series', room: 'bedroom', values: CO2_BY_HOUR, threshold_ppm: 1000, max_ppm: 1500 });

  const scene = (msg: object) => pub(sys, UI_SCENE, { v, ts: now().toISOString(), ...msg });
  sys.subscribe([SYSTEM_EVENTS, SYSTEM_EVENTS_RETAINED, 'vega/system/command']);
  sys.on('message', (topic, payload, packet) => {
    const u = parseMessage(topic, payload.toString());
    if (topic === 'vega/system/command') return log(`[sim] command: ${payload.toString()}`);
    if (!u || u.type !== 'ci' || opts.sceneRule === false) return;
    // old state replayed on subscribe, or the echo of our own startup state (lastFailed holds it already):
    // either may arrive after newer events, so neither may trigger a scene
    if (packet.retain) return;
    if (payload.toString() === startupCi) return void (startupCi = null);
    const prev = lastFailed;
    lastFailed = u.failed;
    if (u.failed > 0 && (prev === 0 || u.failed > prev)) {
      log(`[sim] CI failed in ${u.repo} -> scene alert`);
      scene({
        scene: 'alert',
        ttl: 60,
        id: `ci-${u.repo}-${u.ts}`,
        data: { title: 'build failed', ref: `${u.repo} · main`, error: `${u.repo}: ${u.failed} failing build${u.failed > 1 ? 's' : ''}`, note: 'Desk LED switched to red.' },
      });
    } else if (u.failed === 0 && prev > 0) {
      log(`[sim] CI recovered in ${u.repo} -> scene success`);
      scene({ scene: 'success', ttl: 15, id: `ci-ok-${u.repo}-${u.ts}`, data: { title: u.repo, ref: 'all builds green', checks: ['Tests passed', 'Build green'] } });
    }
  });

  const telemetry = () => {
    for (const d of DEVICES) publishState(d);
  };
  const piTick = () => {
    pub(sys, SYSTEM_PI, { v, ts: now().toISOString(), cpu_pct: Math.round(15 + rng() * 20), temp_c: Math.round(50 + rng() * 5), mem_pct: Math.round(38 + rng() * 6), uptime_s: Math.round((now().getTime() - t0.getTime()) / 1000) + 6 * 86400 });
    pub(sys, SYSTEM_NET, { v, ts: now().toISOString(), latency_ms: Math.round(30 + rng() * 18) });
  };
  piTick();
  timers.push(setInterval(telemetry, interval), setInterval(piTick, opts.piIntervalMs ?? 5000));

  return {
    deviceKeys: DEVICES.map(deviceKey),
    async killDevice(key) {
      const c = clients.get(key);
      if (!c) return;
      clients.delete(key);
      await new Promise<void>((res) => c.end(true, {}, () => res()));
    },
    async reviveDevice(key) {
      const d = DEVICES.find((x) => deviceKey(x) === key);
      if (d && !clients.has(key)) await bringUp(d);
    },
    setCi(failed, repo = 'firmware-esp') {
      pubCi(failed, repo);
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearInterval);
      for (const c of [...clients.values(), sys]) await new Promise<void>((res) => c.end(false, {}, () => res()));
      clients.clear();
    },
  };
}
