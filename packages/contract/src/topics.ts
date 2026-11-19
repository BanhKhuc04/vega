export const ROOT = 'vega';
/** Event stream (not retained). Latest-value events are also sent retained on `vega/system/events/<type>`. */
export const SYSTEM_EVENTS = 'vega/system/events';
export const SYSTEM_EVENTS_RETAINED = 'vega/system/events/+';
export const EVENT_TYPES = ['ci', 'next_event', 'co2_series', 'command_result', 'llm_usage', 'announce'] as const;
/** Retained slot for one kind of event, so the broker keeps the latest `ci` AND the latest `next_event`. */
export const eventTopic = (type: (typeof EVENT_TYPES)[number]): string => `${SYSTEM_EVENTS}/${type}`;
/** True for `vega/system/events` and `vega/system/events/<type>`. */
export const isEventsTopic = (topic: string): boolean => {
  if (topic === SYSTEM_EVENTS) return true;
  const rest = topic.startsWith(`${SYSTEM_EVENTS}/`) ? topic.slice(SYSTEM_EVENTS.length + 1) : '';
  return rest !== '' && !rest.includes('/');
};
export const SYSTEM_COMMAND = 'vega/system/command';
export const SYSTEM_PI = 'vega/system/pi';
export const SYSTEM_NET = 'vega/system/net';
export const UI_SCENE = 'vega/ui/scene';
export const CORE_STATE = 'vega/desk/core/state';

/** Topics the dashboard subscribes to. `vega/desk/core/state` is matched by the first pattern. */
export const DASHBOARD_SUBSCRIPTIONS = [
  'vega/+/+/state',
  'vega/+/+/meta',
  'vega/+/+/availability',
  SYSTEM_EVENTS,
  SYSTEM_EVENTS_RETAINED,
  SYSTEM_PI,
  SYSTEM_NET,
  UI_SCENE,
] as const;

/** Rooms that are not device rooms. */
export const RESERVED_ROOMS = ['system', 'ui'] as const;

export const ID_PATTERN = /^[a-z0-9_-]+$/;
export type DeviceLeaf = 'state' | 'set' | 'meta' | 'availability';
const LEAVES: readonly DeviceLeaf[] = ['state', 'set', 'meta', 'availability'];

export function deviceTopic(room: string, deviceId: string, leaf: DeviceLeaf): string {
  return `${ROOT}/${room}/${deviceId}/${leaf}`;
}

export interface ParsedDeviceTopic {
  room: string;
  deviceId: string;
  leaf: DeviceLeaf;
}

/** Splits `vega/<room>/<device_id>/<leaf>`; null for anything else (including reserved rooms). */
export function parseDeviceTopic(topic: string): ParsedDeviceTopic | null {
  const p = topic.split('/');
  if (p.length !== 4 || p[0] !== ROOT) return null;
  const [, room, deviceId, leaf] = p as [string, string, string, string];
  if (!ID_PATTERN.test(room) || !ID_PATTERN.test(deviceId)) return null;
  if ((RESERVED_ROOMS as readonly string[]).includes(room)) return null;
  const l = LEAVES.find((x) => x === leaf);
  return l ? { room, deviceId, leaf: l } : null;
}
