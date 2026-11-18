import type { Device, Snapshot } from './types';
import type { Update } from './parse';

function upsertDevice(devices: Device[], id: string, patch: Partial<Device>): Device[] {
  const i = devices.findIndex((d) => d.id === id);
  if (i === -1) return [...devices, { id, kind: 'unknown', online: false, ...patch }];
  return devices.map((d, j) => (j === i ? { ...d, ...patch } : d));
}

/** Pure reducer: applies one parsed MQTT update to a snapshot. */
export function applyUpdate(s: Snapshot, u: Update): Snapshot {
  switch (u.type) {
    case 'env': {
      // Merge field-by-field so partial states from separate sensors do not erase each other.
      const prev = s.env && s.env.room === u.room ? s.env : null;
      return {
        ...s,
        env: {
          room: u.room,
          roomName: s.roomNames[u.room] ?? prev?.roomName ?? u.room,
          tempC: u.tempC ?? prev?.tempC ?? null,
          humidity: u.humidity ?? prev?.humidity ?? null,
          co2Ppm: u.co2Ppm ?? prev?.co2Ppm ?? null,
          ts: u.ts,
        },
        devices: upsertDevice(s.devices, `${u.room}/${u.deviceId}`, {}),
      };
    }
    case 'availability':
      return { ...s, devices: upsertDevice(s.devices, `${u.room}/${u.deviceId}`, { online: u.online }) };
    case 'meta': {
      const roomNames = u.roomName ? { ...s.roomNames, [u.room]: u.roomName } : s.roomNames;
      const env = s.env && s.env.room === u.room && u.roomName ? { ...s.env, roomName: u.roomName } : s.env;
      return { ...s, roomNames, env, devices: upsertDevice(s.devices, `${u.room}/${u.deviceId}`, { kind: u.kind }) };
    }
    case 'ci':
      return { ...s, ci: { repo: u.repo, failed: u.failed, ts: u.ts } };
    case 'next':
      return { ...s, next: { title: u.title, at: u.at } };
    case 'co2':
      return { ...s, co2: { room: u.room, values: u.values, thresholdPpm: u.thresholdPpm, maxPpm: u.maxPpm } };
    case 'research':
      return { ...s, research: u.session };
    case 'commandResult':
      return { ...s, history: s.history.map((h) => (h.id === u.id ? { ...h, result: u.result } : h)) };
    case 'core':
      return { ...s, core: u.state };
  }
}
