import { fold } from './text';
import type { ChatRequest, ChatResponse, ToolCallMsg, ToolSpec } from './llm';

/**
 * Provider `mock`: a fixed, offline stand-in for an LLM, for tests, CI and the bench. It reads every user message
 * (including external data) and naively obeys what it finds there, like a gullible model would: the brain's own
 * rules, not the model, must stop injected commands. After tool results it answers with a summary of them.
 */

const has = (t: string, words: string[]) => words.some((w) => ` ${t} `.includes(` ${w} `));
const enumOf = (tools: ToolSpec[] | undefined, tool: string, prop: string): string[] => {
  const p = tools?.find((x) => x.function.name === tool)?.function.parameters as { properties?: Record<string, { enum?: string[] }> } | undefined;
  return p?.properties?.[prop]?.enum ?? [];
};

const ROOM_WORDS: Record<string, string[]> = {
  bedroom: ['phong ngu', 'bedroom'],
  livingroom: ['phong khach', 'living room', 'livingroom'],
  kitchen: ['bep', 'nha bep', 'kitchen'],
  balcony: ['ban cong', 'ngoai troi', 'balcony', 'outside'],
};
const DEVICE_WORDS: Record<string, string[]> = {
  light: ['den', 'light', 'lights', 'lamp'],
  plug: ['o cam', 'plug', 'socket', 'am dun', 'kettle'],
  fan: ['quat', 'fan'],
};

function guess(text: string, tools: ToolSpec[] | undefined): { name: string; args: Record<string, unknown> }[] {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const negated = has(text, ['dung', 'khong can', 'dont', 'do not', 'never']);
  const devices = enumOf(tools, 'set_device', 'device');
  const on = has(text, ['bat', 'mo', 'turn on', 'switch on', 'on', 'sang len']);
  const off = has(text, ['tat', 'turn off', 'switch off', 'off']);
  if (devices.length && (on || off) && !negated) {
    const all = has(text, ['het', 'tat ca', 'moi', 'all', 'everything']);
    const picked = all ? devices : devices.filter((k) => has(text, DEVICE_WORDS[k.split('/')[1]!] ?? [k.split('/')[1]!]));
    for (const device of picked) calls.push({ name: 'set_device', args: { device, on: off ? false : true } });
  }
  if (enumOf(tools, 'run_scene', 'name').length && !negated) {
    if (has(text, ['ngu', 'di ngu', 'sleep', 'good night', 'nghi ngoi'])) calls.push({ name: 'run_scene', args: { name: 'sleep' } });
    else if (has(text, ['tap trung', 'focus', 'lam viec', 'hoc bai', 'pomodoro'])) calls.push({ name: 'run_scene', args: { name: 'focus' } });
  }
  const rooms = enumOf(tools, 'get_sensor', 'room');
  const room = rooms.find((r) => has(text, ROOM_WORDS[r] ?? [r]));
  const metric = has(text, ['co2', 'khong khi', 'ngot', 'thoang', 'stuffy', 'air'])
    ? 'co2'
    : has(text, ['do am', 'am', 'humid', 'humidity', 'kho', 'nom'])
      ? 'humidity'
      : has(text, ['nhiet', 'nong', 'lanh', 'am ap', 'mat me', 'do c', 'may do', 'temp', 'temperature', 'warm', 'hot', 'cold', 'degrees'])
        ? 'temp'
        : null;
  if (metric && calls.length === 0) calls.push({ name: 'get_sensor', args: { metric, ...(room && { room }) } });
  if (calls.length === 0 && has(text, ['thiet bi', 'devices', 'device', 'nhung gi dang bat'])) calls.push({ name: 'list_devices', args: {} });
  return calls;
}

const tokens = (o: unknown) => Math.ceil(JSON.stringify(o).length / 4);

export function mockChat(req: ChatRequest): ChatResponse {
  const msgs = req.messages;
  let lastUser = -1;
  msgs.forEach((m, i) => m.role === 'user' && (lastUser = i));
  const results = msgs.slice(lastUser + 1).filter((m) => m.role === 'tool');
  let message: ChatResponse['message'];
  if (results.length) {
    const texts = results.map((m) => {
      try {
        return String((JSON.parse(m.content) as { text?: unknown }).text ?? m.content);
      } catch {
        return m.content;
      }
    });
    message = { role: 'assistant', content: texts.join(' · ') };
  } else {
    const text = fold(msgs.filter((m) => m.role === 'user').map((m) => m.content).join(' \n '));
    const calls = guess(text, req.tools);
    message = calls.length
      ? { role: 'assistant', content: null, tool_calls: calls.map((c, i): ToolCallMsg => ({ id: `call_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
      : { role: 'assistant', content: 'I can only help with the devices and sensors for now.' };
  }
  return { message, usage: { in: tokens(req), out: tokens(message) } };
}
