import { parseMessage } from '@vega/contract';
import type { DeviceKind, Risk } from '@vega/contract';

export const METRICS = ['temp', 'humidity', 'co2'] as const;
export type Metric = (typeof METRICS)[number];
const FIELD = { temp: 'tempC', humidity: 'humidity', co2: 'co2Ppm' } as const;

export interface Device {
  key: string; // `<room>/<id>`
  room: string;
  id: string;
  kind: DeviceKind | null;
  name: string | null;
  roomName: string | null;
  aliases: string[];
  /** Declared risk; null = not declared (treated as high for switches). */
  risk: Risk | null;
  online: boolean;
  tempC?: number;
  humidity?: number;
  co2Ppm?: number;
  presence?: boolean;
  on?: boolean;
  updated: number;
}

/**
 * What the brain knows about the devices, built only from what they declare on MQTT (`meta`, `availability`, `state`).
 * A device is switchable once it has reported `on`; a sensor once it has reported a reading. New devices need no code.
 */
export class Registry {
  readonly devices = new Map<string, Device>();
  /** Latest `vega/system/pi`. */
  pi: { cpuPct: number | null; tempC: number | null; memPct: number | null; uptimeS: number | null } | null = null;

  /** Feeds one MQTT message; returns true if it changed a device. */
  apply(topic: string, payload: string, now = Date.now()): boolean {
    const u = parseMessage(topic, payload, now);
    if (u?.type === 'pi') {
      this.pi = { cpuPct: u.cpuPct, tempC: u.tempC, memPct: u.memPct, uptimeS: u.uptimeS };
      return true;
    }
    if (!u || (u.type !== 'meta' && u.type !== 'availability' && u.type !== 'state')) return false;
    const d = this.upsert(u.room, u.deviceId, now);
    if (u.type === 'meta') Object.assign(d, { kind: u.kind, name: u.name, roomName: u.roomName, aliases: u.aliases, risk: u.risk });
    else if (u.type === 'availability') d.online = u.online;
    else {
      for (const k of ['tempC', 'humidity', 'co2Ppm', 'presence', 'on'] as const) if (u[k] !== undefined) Object.assign(d, { [k]: u[k] });
      d.online = true; // a device that reports is alive, even if its retained `availability` has not arrived yet
    }
    return true;
  }

  private upsert(room: string, id: string, now: number): Device {
    const key = `${room}/${id}`;
    let d = this.devices.get(key);
    if (!d) {
      d = { key, room, id, kind: null, name: null, roomName: null, aliases: [], risk: null, online: false, updated: now };
      this.devices.set(key, d);
    }
    d.updated = now;
    return d;
  }

  get(key: string): Device | undefined {
    return this.devices.get(key);
  }
  all(): Device[] {
    return [...this.devices.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  switches(): Device[] {
    return this.all().filter((d) => d.on !== undefined);
  }
  rooms(): string[] {
    return [...new Set(this.all().map((d) => d.room))];
  }
  /** Devices with a reading for `metric`, optionally in one room. */
  sensors(metric: Metric, room?: string): Device[] {
    return this.all().filter((d) => d[FIELD[metric]] !== undefined && (!room || d.room === room));
  }
  reading(d: Device, metric: Metric): number | undefined {
    return d[FIELD[metric]];
  }
}

/** "Living room light" */
export const label = (d: Device): string => `${d.roomName ?? d.room} ${d.name ?? d.id}`;
export const roomLabel = (reg: Registry, room: string): string => reg.all().find((d) => d.room === room && d.roomName)?.roomName ?? room;
/** Switches need confirmation unless they declare `risk: low`. */
export const needsConfirm = (d: Device): boolean => d.risk !== 'low';
