import { METRICS, label } from './registry';
import type { Metric, Registry } from './registry';
import type { ToolSpec } from './llm';

export type ToolName = 'list_devices' | 'get_sensor' | 'set_device' | 'run_scene' | 'ci_status' | 'ci_explain' | 'system_status';
export const SCENE_NAMES = ['sleep', 'focus'] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export type ToolCall =
  | { name: 'list_devices'; args: Record<string, never> }
  | { name: 'get_sensor'; args: { metric: Metric; room?: string } }
  | { name: 'set_device'; args: { device: string; on: boolean } }
  | { name: 'run_scene'; args: { name: SceneName } }
  | { name: 'ci_status'; args: Record<string, never> }
  | { name: 'ci_explain'; args: { repo?: string } }
  | { name: 'system_status'; args: Record<string, never> };

/** Tools that change something in the physical world. They only run on a direct command from the owner. */
export const PHYSICAL: ReadonlySet<ToolName> = new Set(['set_device', 'run_scene']);

/**
 * Tool definitions for the LLM, generated from the registry: the device and room enums are whatever the devices
 * declared, so a new device needs no code. `physical: false` leaves out the tools that act on the world.
 */
export function toolSpecs(reg: Registry, opts: { physical?: boolean; ciRepos?: string[] } = {}): ToolSpec[] {
  const fn = (name: ToolName, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolSpec => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
  });
  const sensorRooms = [...new Set(METRICS.flatMap((m) => reg.sensors(m).map((d) => d.room)))];
  const switches = reg.switches();
  const specs: ToolSpec[] = [
    fn('list_devices', 'List the devices in the home with their room, state and whether they are online.'),
    fn('system_status', 'Overall status of VEGA: the Pi (temperature, CPU, RAM, uptime), devices online, CI, AI budget today.'),
    fn('get_sensor', 'Read a sensor: temperature (°C), relative humidity (%) or CO2 (ppm). Without a room, the main room is used.', {
      metric: { type: 'string', enum: [...METRICS] },
      ...(sensorRooms.length && { room: { type: 'string', enum: sensorRooms } }),
    }, ['metric']),
  ];
  if (opts.ciRepos?.length) {
    specs.push(
      fn('ci_status', 'State of the GitHub Actions builds of the watched repositories (which workflows fail, with commit).'),
      fn('ci_explain', 'Read the log of the latest failed build (optionally of one repository) to explain why it failed.', { repo: { type: 'string', enum: opts.ciRepos } }),
    );
  }
  if (opts.physical !== false) {
    if (switches.length) {
      specs.push(
        fn('set_device', `Switch a device on or off. Devices: ${switches.map((d) => `${d.key} (${label(d)})`).join(', ')}.`, {
          device: { type: 'string', enum: switches.map((d) => d.key) },
          on: { type: 'boolean' },
        }, ['device', 'on']),
      );
    }
    specs.push(fn('run_scene', 'Run a home scene: sleep (lights off, sleep screen) or focus (focus timer).', { name: { type: 'string', enum: [...SCENE_NAMES] } }, ['name']));
  }
  return specs;
}

/** Validates a tool call coming from the LLM (untrusted) against the registry. */
export function parseToolCall(name: string, argsJson: string, reg: Registry, ciRepos: string[] = []): { ok: true; call: ToolCall } | { ok: false; error: string } {
  let a: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(argsJson || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'arguments must be a JSON object' };
    a = v as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'arguments are not valid JSON' };
  }
  switch (name) {
    case 'list_devices':
    case 'system_status':
      return { ok: true, call: { name, args: {} } };
    case 'get_sensor': {
      if (!(METRICS as readonly unknown[]).includes(a.metric)) return { ok: false, error: `metric must be one of ${METRICS.join(', ')}` };
      if (a.room !== undefined && (typeof a.room !== 'string' || !reg.rooms().includes(a.room))) return { ok: false, error: 'unknown room' };
      return { ok: true, call: { name, args: { metric: a.metric as Metric, ...(typeof a.room === 'string' && { room: a.room }) } } };
    }
    case 'set_device': {
      if (typeof a.device !== 'string' || !reg.switches().some((d) => d.key === a.device)) return { ok: false, error: 'unknown device' };
      if (typeof a.on !== 'boolean') return { ok: false, error: 'on must be true or false' };
      return { ok: true, call: { name, args: { device: a.device, on: a.on } } };
    }
    case 'run_scene':
      if (!(SCENE_NAMES as readonly unknown[]).includes(a.name)) return { ok: false, error: `name must be one of ${SCENE_NAMES.join(', ')}` };
      return { ok: true, call: { name, args: { name: a.name as SceneName } } };
    case 'ci_status':
      if (!ciRepos.length) return { ok: false, error: 'CI watching is not set up' };
      return { ok: true, call: { name, args: {} } };
    case 'ci_explain':
      if (!ciRepos.length) return { ok: false, error: 'CI watching is not set up' };
      if (a.repo !== undefined && (typeof a.repo !== 'string' || !ciRepos.includes(a.repo))) return { ok: false, error: 'unknown repository' };
      return { ok: true, call: { name, args: { ...(typeof a.repo === 'string' && { repo: a.repo }) } } };
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

/** Short text for a chip on the Think screen, e.g. "set_device livingroom/light". */
export function chipLabel(c: ToolCall): string {
  const arg =
    c.name === 'get_sensor' ? `${c.args.metric}${c.args.room ? ` ${c.args.room}` : ''}` : c.name === 'set_device' ? c.args.device : c.name === 'run_scene' ? c.args.name : c.name === 'ci_explain' ? (c.args.repo ?? '') : '';
  return `${c.name}${arg ? ` ${arg}` : ''}`.slice(0, 40);
}
