import type { Update } from '@vega/contract';
import type { Device, Snapshot } from './types';

function upsertDevice(devices: Device[], id: string, patch: Partial<Device>): Device[] {
  const i = devices.findIndex((d) => d.id === id);
  if (i === -1) return [...devices, { id, kind: 'unknown', online: false, ...patch }];
  return devices.map((d, j) => (j === i ? { ...d, ...patch } : d));
}

const SPARK_LEN = 24;

/** Pure reducer: applies one decoded MQTT update to a snapshot. Scene updates are not state. */
export function applyUpdate(s: Snapshot, u: Update): Snapshot {
  switch (u.type) {
    case 'state': {
      const id = `${u.room}/${u.deviceId}`;
      const devices = upsertDevice(s.devices, id, {});
      if (u.room !== s.primaryRoom) return { ...s, devices };
      // Merge field by field so partial states from separate sensors do not erase each other.
      const prev = s.env;
      const touchesEnv = u.tempC !== undefined || u.humidity !== undefined || u.co2Ppm !== undefined;
      const env = touchesEnv
        ? {
            room: u.room,
            roomName: s.roomNames[u.room] ?? prev?.roomName ?? u.room,
            tempC: u.tempC ?? prev?.tempC ?? null,
            humidity: u.humidity ?? prev?.humidity ?? null,
            co2Ppm: u.co2Ppm ?? prev?.co2Ppm ?? null,
            ts: u.ts,
          }
        : prev;
      const co2Spark = u.co2Ppm !== undefined ? [...s.co2Spark, u.co2Ppm].slice(-SPARK_LEN) : s.co2Spark;
      return { ...s, devices, env, co2Spark, presence: u.presence ?? s.presence };
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
    case 'nextEvent':
      return { ...s, next: { title: u.title, detail: u.detail, at: u.at } };
    case 'co2Series': {
      const series = { room: u.room, values: u.values, thresholdPpm: u.thresholdPpm, maxPpm: u.maxPpm };
      const seed = u.room === s.primaryRoom && s.co2Spark.length === 0 ? u.values.slice(-SPARK_LEN) : s.co2Spark;
      return { ...s, co2Series: series, co2Spark: seed, co2Threshold: u.thresholdPpm };
    }
    case 'pi':
      return { ...s, pi: { cpuPct: u.cpuPct, tempC: u.tempC, memPct: u.memPct, uptimeS: u.uptimeS } };
    case 'net':
      return { ...s, net: { latencyMs: u.latencyMs } };
    case 'core':
      return { ...s, core: u.state };
    case 'llmUsage':
      return { ...s, ai: { day: u.day, spentUsd: u.spentUsd, budgetUsd: u.budgetUsd, calls: u.calls } };
    case 'commandResult':
    case 'announce':
    case 'scene':
    case 'sceneInvalid':
      return s;
  }
}
