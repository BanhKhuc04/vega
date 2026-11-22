import { METRICS, label } from './registry';
import type { Metric, Registry } from './registry';
import type { ToolSpec } from './llm';

export type ToolName = ToolCall['name'];
export const SCENE_NAMES = ['sleep', 'focus'] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export type ToolCall =
  | { name: 'list_devices'; args: Record<string, never> }
  | { name: 'get_sensor'; args: { metric: Metric; room?: string } }
  | { name: 'set_device'; args: { device: string; on: boolean } }
  | { name: 'run_scene'; args: { name: SceneName; minutes?: number } }
  | { name: 'ci_status'; args: Record<string, never> }
  | { name: 'ci_explain'; args: { repo?: string } }
  | { name: 'system_status'; args: Record<string, never> }
  | { name: 'calendar_list'; args: { day: 'today' | 'tomorrow' | 'next' } }
  | { name: 'mail_list'; args: Record<string, never> }
  | { name: 'weather'; args: Record<string, never> }
  | { name: 'briefing'; args: Record<string, never> }
  | { name: 'add_reminder'; args: { at: number; text: string } }
  | { name: 'list_reminders'; args: Record<string, never> }
  | { name: 'cancel_reminder'; args: { id: number } }
  | { name: 'snooze'; args: Record<string, never> }
  | { name: 'focus_stop'; args: Record<string, never> }
  | { name: 'web_search'; args: { query: string } }
  | { name: 'look'; args: { question?: string; live?: boolean } } // live: the Vision screen's live video (M7.1), local command only
  | { name: 'locate'; args: Record<string, never> } // the phone's position (M8), local command only: coordinates never reach an AI
  | { name: 'set_home'; args: Record<string, never> } // "đây là nhà": the phone's position becomes home (M8), local command only
  // memory (M9): only `remember` is ever offered to an AI, as a suggestion the owner confirms; the rest are local commands
  | { name: 'remember'; args: { text: string; secret?: boolean; pinned?: boolean; suggested?: boolean } }
  | { name: 'memory_list'; args: Record<string, never> }
  | { name: 'recall'; args: { id: number } }
  | { name: 'forget'; args: { id?: number; query?: string } }
  | { name: 'forget_all'; args: Record<string, never> }
  | { name: 'memory_level'; args: { id: number; level: 'normal' | 'private' } };

/** Tools about the memory: their turns never enter the conversation history sent to an AI (they may show private items). */
export const MEMORY_TOOLS: ReadonlySet<ToolName> = new Set(['remember', 'memory_list', 'recall', 'forget', 'forget_all', 'memory_level']);

/**
 * Tools that act: on the physical world (devices, scenes; a Focus holds notifications) or on the owner's reminders.
 * They only run on a direct command from the owner, never with outside content (mail, calendar, logs) in play.
 */
export const PHYSICAL: ReadonlySet<ToolName> = new Set(['set_device', 'run_scene', 'add_reminder', 'cancel_reminder', 'set_home', 'remember', 'forget', 'forget_all', 'memory_level']);

/** "2026-11-19T15:30" (local) or an ISO time with offset -> ms; NaN if neither. */
export function parseWhen(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime();
  return /(Z|[+-]\d{2}:?\d{2})$/.test(s.trim()) ? Date.parse(s) : NaN;
}

/** What the personal-assistant tools can reach (M4). */
export interface PersonalTools {
  google: boolean;
  weather: boolean;
}

/**
 * Tool definitions for the LLM, generated from the registry: the device and room enums are whatever the devices
 * declared, so a new device needs no code. `physical: false` leaves out the tools that act on the world.
 */
export function toolSpecs(reg: Registry, opts: { physical?: boolean; ciRepos?: string[]; personal?: PersonalTools; search?: boolean; camera?: boolean; suggestMemory?: boolean } = {}): ToolSpec[] {
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
  if (opts.search) {
    specs.push(
      fn('web_search', 'Search the web once for recent facts (prices, news, versions). Returns up to 5 numbered results; cite them as [1], [2] in the answer. At most one search per question.', { query: { type: 'string', description: 'A few words.' } }, ['query']),
    );
  }
  // a photo leaves the home: only on a direct command from the owner (offered like the physical tools)
  if (opts.camera && opts.physical !== false) {
    specs.push(fn('look', "Take a photo with the camera above the owner's desk and look at it. Use for questions about what is on the desk or what something there looks like.", { question: { type: 'string', description: 'What to look for, in the words of the owner.' } }));
  }
  const p = opts.personal;
  if (p?.google) {
    specs.push(
      fn('calendar_list', "The owner's Google Calendar events: today, tomorrow, or the next one.", { day: { type: 'string', enum: ['today', 'tomorrow', 'next'] } }, ['day']),
      fn('mail_list', 'Unread mail in the Primary inbox of the last day: sender and subject only.'),
    );
  }
  if (p?.weather) specs.push(fn('weather', "Current weather and today's forecast at home."));
  if (p) specs.push(fn('list_reminders', 'List the reminders still to come, with their number.'));
  if (opts.physical !== false && p) {
    specs.push(
      fn('add_reminder', 'Remind the owner of something at a time. `at` is local time, "YYYY-MM-DDTHH:MM".', { at: { type: 'string' }, text: { type: 'string', description: 'What to remind, in the words of the owner, short.' } }, ['at', 'text']),
      fn('cancel_reminder', 'Cancel a reminder by its number.', { id: { type: 'integer' } }, ['id']),
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
    specs.push(
      fn('run_scene', 'Run a home scene: sleep (lights off, sleep screen) or focus (focus timer that holds notifications).', { name: { type: 'string', enum: [...SCENE_NAMES] }, minutes: { type: 'integer', description: 'Focus length, 1-180 (default 25).' } }, ['name']),
    );
    if (opts.suggestMemory) {
      specs.push(
        fn('remember', 'Offer to remember a lasting preference or habit the owner just stated (e.g. "likes warm light", "wakes up at 6"). The owner must confirm; at most once per conversation. Never for passwords, numbers, health, money or other people.', { text: { type: 'string', description: 'One short sentence, in the words of the owner.' } }, ['text']),
      );
    }
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
    case 'mail_list':
    case 'weather':
    case 'briefing':
    case 'list_reminders':
    case 'snooze':
    case 'focus_stop':
      return { ok: true, call: { name, args: {} } };
    case 'web_search':
      if (typeof a.query !== 'string' || !a.query.trim() || a.query.length > 300) return { ok: false, error: 'query must be 1-300 characters' };
      return { ok: true, call: { name, args: { query: a.query.trim() } } };
    case 'look':
      if (a.question !== undefined && (typeof a.question !== 'string' || a.question.length > 300)) return { ok: false, error: 'question must be at most 300 characters' };
      return { ok: true, call: { name, args: { ...(typeof a.question === 'string' && a.question.trim() && { question: a.question.trim() }) } } };
    case 'calendar_list':
      if (a.day !== 'today' && a.day !== 'tomorrow' && a.day !== 'next') return { ok: false, error: 'day must be today, tomorrow or next' };
      return { ok: true, call: { name, args: { day: a.day } } };
    case 'add_reminder': {
      const at = typeof a.at === 'string' ? parseWhen(a.at) : NaN;
      if (!Number.isFinite(at)) return { ok: false, error: 'at must be local time "YYYY-MM-DDTHH:MM"' };
      if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 200) return { ok: false, error: 'text must be 1-200 characters' };
      return { ok: true, call: { name, args: { at, text: a.text.trim() } } };
    }
    case 'remember':
      if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 300) return { ok: false, error: 'text must be 1-300 characters' };
      return { ok: true, call: { name, args: { text: a.text.trim(), suggested: true } } };
    case 'cancel_reminder':
      if (!Number.isInteger(a.id) || (a.id as number) < 1) return { ok: false, error: 'id must be a reminder number' };
      return { ok: true, call: { name, args: { id: a.id as number } } };
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
    case 'run_scene': {
      if (!(SCENE_NAMES as readonly unknown[]).includes(a.name)) return { ok: false, error: `name must be one of ${SCENE_NAMES.join(', ')}` };
      if (a.minutes !== undefined && (!Number.isInteger(a.minutes) || (a.minutes as number) < 1 || (a.minutes as number) > 180)) return { ok: false, error: 'minutes must be 1-180' };
      return { ok: true, call: { name, args: { name: a.name as SceneName, ...(a.name === 'focus' && typeof a.minutes === 'number' && { minutes: a.minutes }) } } };
    }
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
  const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  const arg =
    c.name === 'get_sensor' ? `${c.args.metric}${c.args.room ? ` ${c.args.room}` : ''}`
    : c.name === 'set_device' ? c.args.device
    : c.name === 'run_scene' ? `${c.args.name}${c.args.minutes ? ` ${c.args.minutes}m` : ''}`
    : c.name === 'ci_explain' ? (c.args.repo ?? '')
    : c.name === 'calendar_list' ? c.args.day
    : c.name === 'add_reminder' ? hhmm(c.args.at)
    : c.name === 'cancel_reminder' ? `#${c.args.id}`
    : c.name === 'web_search' ? c.args.query
    : '';
  return `${c.name}${arg ? ` ${arg}` : ''}`.slice(0, 40);
}
