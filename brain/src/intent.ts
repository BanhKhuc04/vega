import { fold } from './text';
import { FILLERS, FILLER_PHRASES, IT, SPLIT } from './local';
import type { LocalOptions } from './local';
import type { Metric, Registry } from './registry';
import type { SceneName, ToolCall } from './tools';

/**
 * Second local tier (M11, brief 0018), between the exact router (local.ts) and the LLM: understands a command said
 * differently ("cho đèn sáng lên", "tắt ổ cắm trong bếp giúp, sợ cháy") or misheard by STT ("phòng mỹ độ") by its
 * closest example sentence (character trigrams, TF-IDF, cosine), then takes the device and room from the same name
 * tables as the exact router. No model file, no network, well under a millisecond.
 *
 * It is stricter than it looks: a device is switched only with an on/off verb that agrees with the meaning, a device
 * named unambiguously, and no negation, time, condition or question word in that clause; anything it is unsure of goes
 * to the LLM. Reading sensors and listing devices only need the meaning to be clear.
 */

type Intent = 'on' | 'off' | Metric | SceneName | 'list' | 'none';

// Written for this tier, not copied from brain/bench/cases.jsonl: the bench measures how well it generalises.
const EXAMPLES: Record<Intent, string[]> = {
  on: [
    'bật đèn', 'mở đèn', 'bật đèn lên đi', 'bật giúp cái đèn', 'cho đèn sáng', 'làm đèn sáng lên', 'mở giùm đèn',
    'bật dùm cái đèn với', 'thắp đèn lên', 'bật ổ cắm', 'mở ổ cắm', 'cấp điện ổ cắm', 'bật hết đèn', 'bật tất cả',
    'mở đèn ra', 'turn on the light', 'switch the lamp on', 'lights on', 'put the light on', 'power on the plug',
    'turn the socket on',
  ],
  off: [
    'tắt đèn', 'tắt đèn đi', 'tắt giùm cái đèn', 'tắt bớt đèn', 'tắt hết đèn đi', 'tắt ổ cắm', 'ngắt ổ cắm',
    'ngắt điện ổ cắm', 'tắt tất cả', 'tắt hết mọi thứ', 'tắt dùm cái ổ cắm', 'turn off the light', 'switch the lamp off',
    'lights off', 'kill the lights', 'power off the plug', 'turn everything off', 'cut the power to the socket',
  ],
  temp: [
    'nhiệt độ bao nhiêu', 'mấy độ rồi', 'phòng nóng không', 'trời có lạnh không', 'trời có mát không',
    'nhiệt độ trong phòng', 'nhiệt độ ngoài trời', 'bây giờ bao nhiêu độ', 'nóng không', 'ngoài kia lạnh không',
    'nhiệt độ ban công', 'oi bức không', 'what is the temperature', 'how hot is it', 'is it cold outside',
    'temperature in the bedroom', 'how warm is the room',
  ],
  humidity: [
    'độ ẩm bao nhiêu', 'phòng ẩm không', 'ẩm thấp không', 'độ ẩm trong phòng', 'độ ẩm ngoài trời',
    'trời có hanh khô không', 'không khí khô không', 'độ ẩm hiện tại', 'how humid is it', 'humidity level',
    'is the air dry',
  ],
  co2: [
    'co2 bao nhiêu', 'nồng độ co2', 'chất lượng không khí', 'không khí có sạch không', 'phòng có bí không',
    'có ngột ngạt không', 'phòng bí bách quá', 'không khí có tốt không', 'chỉ số co2', 'air quality', 'co2 level',
    'is the air stuffy', 'how fresh is the air',
  ],
  sleep: [
    'đi ngủ', 'ngủ thôi', 'tôi đi ngủ đây', 'chuẩn bị đi ngủ', 'chế độ ngủ', 'chúc ngủ ngon', 'ngủ ngon nhé',
    'good night', 'time for bed', 'i am going to bed', 'sleep mode on',
  ],
  focus: [
    'vào chế độ tập trung', 'tập trung làm việc', 'mình cần tập trung', 'bắt đầu làm việc', 'bắt đầu học', 'học bài',
    'làm việc sâu', 'pomodoro', 'mở pomodoro', 'focus mode', 'start focusing', 'deep work time', 'i need to study',
    'let me concentrate',
  ],
  list: [
    'có những thiết bị gì', 'danh sách thiết bị', 'kể tên thiết bị', 'nhà có gì điều khiển được', 'thiết bị nào đang mở',
    'những gì đang bật', 'cái gì đang chạy', 'các thiết bị trong nhà', 'list devices', 'what devices do i have',
    'what is switched on', 'show all devices',
  ],
  none: [
    'kể chuyện cười', 'kể một câu chuyện', 'thủ đô nước nhật là gì', 'ai là tổng thống mỹ', 'cảm ơn nhé', 'cảm ơn bạn',
    'bạn tên gì', 'bạn khỏe không', 'ngày mấy tháng mấy', 'hôm nay thứ mấy', 'viết một đoạn văn', 'làm thơ về mùa thu',
    'dịch câu này sang tiếng anh', 'hát một bài đi', 'mở nhạc', 'bật nhạc lên', 'mở youtube', 'gửi tin nhắn cho mẹ',
    'gọi điện cho bố', 'buồn ngủ', 'mệt mỏi', 'trời có nắng không', 'thời tiết có đẹp không', 'có bão không', // the sky, not a sensor 'tell me a joke', 'what is the capital of japan', 'thank you',
    'who are you', 'write an email', 'play some music',
  ],
};

/** Below this the meaning is unclear: the piece is context at best. */
const MIN_SCORE = 0.45;
/** A device switch or a scene needs a clearer match than a read. */
const ACT_SCORE = 0.55;
/** A piece this close to small talk or another request sends the whole command to the LLM. */
const NONE_SCORE = 0.5;
/** A read beside a switch in the same command: it must be this clear, or it is just a remark. */
const CONTEXT_READ_SCORE = 0.8;

const ON = ['turn on', 'switch on', 'sang len', 'bat', 'mo', 'on']; // "cho đèn sáng lên"; "sáng quá" is only a remark
const OFF = ['turn off', 'switch off', 'tat', 'ngat', 'off'];
const ALL = ['tat ca', 'moi thu', 'everything', 'het', 'all'];
/** Words that change what a switch command means: never act on them here. */
const BLOCK = new Set(
  'khong dung chua chang neu khi sau luc truoc gio phut giay tieng mai dont not never if when after before until at minute minutes hour hours tomorrow tonight is are was were did does'.split(' '),
);

/** A read here gives today's value only: advice, comparison, cause, past and future are the LLM's ("có nên mặc áo khoác"). */
const READ_BLOCK = ['nen', 'hon', 'tai sao', 'vi sao', 'lam sao', 'hom qua', 'ngay mai', 'du bao', 'should', 'than', 'why', 'yesterday', 'tomorrow', 'forecast'];

const has = (s: string, p: string) => p !== '' && ` ${s} `.includes(` ${p} `);
const without = (s: string, phrases: readonly string[]) => phrases.reduce((t, p) => ` ${t} `.split(` ${p} `).join(' ').trim(), s);
/** Names of things and places say which device or room, not what to do: the classifier never sees them. */
const NAMES = ['phong khach', 'phong ngu', 'ban cong', 'ngoai troi', 'o cam', 'bep', 'den', 'hom nay', 'living room', 'bedroom', 'balcony', 'kitchen', 'outside', 'light', 'lamp', 'plug', 'socket'];
/** What the classifier sees: no filler ("vega ơi", "giúp mình", "nhé") and no device or room names. */
const core = (folded: string, names: readonly string[] = []) =>
  without(without(folded, FILLER_PHRASES), [...names, ...NAMES].sort((a, b) => b.length - a.length))
    .split(' ')
    .filter((w) => w && !FILLERS.has(w))
    .join(' ');

function features(s: string): Map<string, number> {
  const f = new Map<string, number>();
  const add = (k: string) => f.set(k, (f.get(k) ?? 0) + 1);
  const words = s.split(' ').filter(Boolean);
  words.forEach((w, i) => {
    add(`#${w}`);
    if (i > 0) add(`#${words[i - 1]}_${w}`); // "độ ẩm" is humidity, "độ" alone is temperature
    const p = ` ${w} `;
    for (let j = 0; j + 3 <= p.length; j++) add(p.slice(j, j + 3));
  });
  return f;
}

interface Model {
  idf: Map<string, number>;
  rows: { intent: Intent; v: Map<string, number> }[];
}
let model: Model | null = null;

function vector(f: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const v = new Map<string, number>();
  let n = 0;
  for (const [k, tf] of f) {
    const w = (1 + Math.log(tf)) * (idf.get(k) ?? 0);
    if (w > 0) {
      v.set(k, w);
      n += w * w;
    }
  }
  n = Math.sqrt(n) || 1;
  for (const [k, w] of v) v.set(k, w / n);
  return v;
}

function build(): Model {
  const docs = Object.entries(EXAMPLES).flatMap(([intent, xs]) => xs.map((x) => ({ intent: intent as Intent, f: features(core(fold(x))) })));
  const df = new Map<string, number>();
  for (const d of docs) for (const k of d.f.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = new Map([...df].map(([k, n]) => [k, Math.log((docs.length + 1) / (n + 1)) + 1]));
  return { idf, rows: docs.map((d) => ({ intent: d.intent, v: vector(d.f, idf) })) };
}

/** The closest example's intent and its cosine similarity (0..1). `names`: this home's device and room names (folded). */
export function classify(text: string, names: readonly string[] = []): { intent: Intent; score: number } {
  model ??= build();
  const v = vector(features(core(fold(text), names)), model.idf);
  let best: { intent: Intent; score: number } = { intent: 'none', score: 0 };
  for (const r of model.rows) {
    let s = 0;
    for (const [k, w] of v) s += w * (r.v.get(k) ?? 0);
    if (s > best.score) best = { intent: r.intent, score: s };
  }
  return best;
}

/** The longest phrase of `names` found in `s`, and what it names; several values when the phrase is shared. */
function longest<T>(s: string, names: Map<string, T[]>): T[] {
  let best = '';
  for (const p of names.keys()) if (p.length > best.length && has(s, p)) best = p;
  return best ? names.get(best)! : [];
}

/** Returns tool calls for `text`, or null when this tier is not sure (the LLM then decides). */
export function routeIntent(text: string, reg: Registry, opts: LocalOptions): ToolCall[] | null {
  const switches = reg.switches();
  const devices = new Map<string, string[]>();
  const rooms = new Map<string, string[]>();
  for (const d of reg.all()) {
    for (const n of [d.room, d.roomName ? fold(d.roomName) : '']) if (n) rooms.set(n, [d.room]);
    if (d.on === undefined) for (const a of d.aliases) rooms.set(fold(a), [d.room]);
  }
  for (const d of switches) {
    for (const p of new Set([...d.aliases.map(fold), d.id, `${fold(d.roomName ?? d.room)} ${d.id}`])) {
      if (p) devices.set(p, [...new Set([...(devices.get(p) ?? []), d.key])]);
    }
  }

  // a comma-separated piece may be context ("trời tối rồi, bật đèn lên"); pieces joined by "và", "rồi" are all requests
  const pieces = text
    .split(/[,;.!?\n]+/)
    .map(fold)
    .filter(Boolean)
    .flatMap((seg) => {
      const parts = seg.split(SPLIT).map((p) => p.trim()).filter(Boolean);
      return parts.map((s) => ({ s, alone: parts.length === 1, ...classify(s, [...devices.keys(), ...rooms.keys()]) }));
    });
  if (pieces.length === 0) return null;

  const verb = (s: string) => {
    const t = without(s, ['bat dau', ...ALL]); // "bắt đầu" is not "bật", "tất cả" is not "tắt"
    return { on: ON.some((p) => has(t, p)), off: OFF.some((p) => has(t, p)) };
  };
  const acts = (p: (typeof pieces)[number]) => !['none', 'list', 'temp', 'humidity', 'co2'].includes(p.intent) && p.score >= ACT_SCORE;
  const action = pieces.some(acts);
  // next to a switch or a scene, a remark ("phòng khách tối quá", "sợ cháy") counts as a question only if it clearly is one
  const context = (p: (typeof pieces)[number]) => {
    const v = verb(p.s);
    if (!p.alone || v.on || v.off || /\d/.test(p.s)) return false;
    if (p.intent === 'on' || p.intent === 'off') return true; // about a switch but no verb: "phòng khách sáng quá", "đèn thế nào"
    return p.score < (p.intent === 'none' ? NONE_SCORE : action && !acts(p) ? CONTEXT_READ_SCORE : MIN_SCORE);
  };
  const ctxRoom = pieces.filter(context).map((p) => longest(p.s, rooms)[0]).find(Boolean) ?? null;

  const calls: ToolCall[] = [];
  for (const p of pieces) {
    if (context(p)) continue;
    if (p.intent === 'none' || p.score < MIN_SCORE || READ_BLOCK.some((w) => has(p.s, w))) return null;
    const room = longest(p.s, rooms)[0] ?? ctxRoom;
    if (p.intent === 'temp' || p.intent === 'humidity' || p.intent === 'co2') {
      calls.push({ name: 'get_sensor', args: { metric: p.intent, room: room ?? opts.defaultRoom } });
      continue;
    }
    if (p.intent === 'list') {
      calls.push({ name: 'list_devices', args: {} });
      continue;
    }
    if (p.score < ACT_SCORE) return null;
    // "học bài 25 phút": the length is the one number a scene may carry
    const m = p.intent === 'focus' ? / (\d{1,3}) (phut|p|minutes|minute|mins|min|tieng|gio|hours|hour|h)(?= )/.exec(` ${p.s} `) : null;
    const rest = m ? ` ${p.s} `.replace(m[0], ' ') : p.s;
    if (/\d/.test(rest) || without(rest, ['bay gio', 'co2']).split(' ').some((w) => BLOCK.has(w))) return null;
    if (p.intent === 'sleep' || p.intent === 'focus') {
      const minutes = m ? Number(m[1]) * (/^(tieng|gio|hours|hour|h)$/.test(m[2]!) ? 60 : 1) : undefined;
      if (minutes !== undefined && (minutes < 1 || minutes > 180)) return null;
      calls.push({ name: 'run_scene', args: { name: p.intent, ...(minutes && { minutes }) } });
      continue;
    }
    // a switch: the verb must be said and agree with the meaning
    const v = verb(p.s);
    const want = p.intent === 'on';
    if (v.on === v.off || v.on !== want) return null;
    const all = ALL.some((a) => has(p.s, a));
    const recent = (opts.recent?.devices ?? []).filter((k) => switches.some((d) => d.key === k));
    let keys = longest(p.s, devices);
    if (keys.length === 0) keys = all ? switches.map((d) => d.key) : IT.some((w) => has(p.s, w)) ? recent : [];
    if (room) keys = keys.filter((k) => reg.get(k)!.room === room); // "phòng ngủ tối quá, bật đèn": not the living room's
    if (keys.length === 0 || (keys.length > 1 && !all)) return null;
    for (const device of keys) calls.push({ name: 'set_device', args: { device, on: want } });
  }
  return calls.length > 0 ? calls : null;
}
