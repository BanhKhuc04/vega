import { fold } from './text';
import type { Metric, Registry } from './registry';
import type { SceneName, ToolCall } from './tools';

/**
 * Local router (no LLM, works offline): understands everyday device commands in Vietnamese and English.
 * Every clause must be understood completely: once the phrases it knows are taken out, only filler words may be
 * left. Anything else (a negation, a time, a word it does not know) sends the whole command to the LLM instead,
 * so "đừng bật đèn" or "bật đèn sau 5 phút" are never executed as "bật đèn".
 */

const SCENES: [SceneName, string[]][] = [
  ['sleep', ['di ngu', 'ngu thoi', 'chuc ngu ngon', 'che do ngu', 'good night', 'goodnight', 'bedtime', 'go to sleep', 'sleep mode', 'sleep']],
  ['focus', ['che do tap trung', 'tap trung', 'focus mode', 'focus', 'pomodoro', 'deep work']],
];
const CI: [('ci_explain' | 'ci_status' | 'system_status'), string[]][] = [
  ['ci_explain', ['tai sao build loi', 'vi sao build loi', 'sao build loi', 'tai sao ci fail', 'vi sao ci fail', 'tai sao fail', 'vi sao fail', 'sao lai fail', 'sao fail', 'giai thich loi build', 'giai thich loi', 'why did the build fail', 'why did ci fail', 'why did it fail', 'explain the error', 'explain the failure']],
  ['ci_status', ['tinh trang build', 'trang thai build', 'tinh trang ci', 'trang thai ci', 'build the nao', 'ci the nao', 'build status', 'ci status', 'builds', 'build', 'ci']], // "thế nào" is a filler phrase: "ci thế nào" leaves "ci"
  ['system_status', ['trang thai he thong', 'tinh trang he thong', 'system status', 'he thong', 'trang thai', 'tinh trang', 'status']], // "/status"
];
/** Personal assistant (M4): questions that read, and the reminder / Focus controls. Checked before scenes and devices. */
const INFO: [ToolCall, string[]][] = [
  [{ name: 'briefing', args: {} }, ['tom tat hom nay', 'tom tat buoi sang', 'tom tat ngay', 'morning briefing', 'daily briefing', 'briefing', 'tom tat']],
  [{ name: 'list_reminders', args: {} }, ['danh sach nhac nho', 'nhac nho cua toi', 'nhung loi nhac', 'loi nhac', 'nhac nho', 'my reminders', 'list reminders', 'list my reminders', 'reminders']],
  [{ name: 'snooze', args: {} }, ['nhac lai sau', 'hoan nhac', 'snooze']],
  [{ name: 'focus_stop', args: {} }, ['dung tap trung', 'ket thuc tap trung', 'huy tap trung', 'thoi tap trung', 'stop focusing', 'stop focus', 'end focus']],
  [{ name: 'mail_list', args: {} }, ['mail chua doc', 'thu chua doc', 'email moi', 'mail moi', 'thu moi', 'hop thu', 'unread emails', 'unread email', 'unread mail', 'new emails', 'new email', 'new mail', 'any mail', 'inbox', 'emails', 'email', 'mail', 'gmail']],
  [{ name: 'weather', args: {} }, ['du bao thoi tiet', 'thoi tiet', 'du bao', 'troi co mua khong', 'co mua khong', 'troi mua', 'weather forecast', 'weather', 'forecast', 'will it rain', 'is it raining']],
];
const CALENDAR = ['lich lam viec', 'lich hen', 'lich trinh', 'su kien', 'lich', 'what s on', 'whats on', 'calendar', 'agenda', 'schedule', 'meetings', 'events'];
const CANCEL_REMINDER = ['huy loi nhac', 'xoa loi nhac', 'huy nhac nho', 'xoa nhac nho', 'huy nhac', 'xoa nhac', 'cancel reminder', 'delete reminder', 'remove reminder'];
/** Words that may trail a question that only reads ("có mail gì mới không"); never taken next to a device command. */
const INFO_TAIL = ['moi khong', 'chua doc', 'khong', 'moi', 'nao', 'ra sao', 'sao', 'for me', 'my', 'any', 'do i have', 'have', 'i'];

const METRICS: [Metric, string[]][] = [
  ['humidity', ['do am', 'am khong', 'am bao nhieu', 'how humid', 'humidity', 'humid']],
  ['co2', ['chat luong khong khi', 'khong khi', 'ngot ngat', 'air quality', 'co2']],
  ['temp', ['bao nhieu do', 'may do', 'nhiet do', 'nong khong', 'lanh khong', 'nong', 'lanh', 'how hot', 'how warm', 'how cold', 'temperature', 'temp']],
];
const ALL = ['tat ca', 'het', 'moi', 'everything', 'all'];
const ON = ['turn on', 'switch on', 'bat', 'mo', 'on'];
const OFF = ['turn off', 'switch off', 'tat', 'off'];
const LIST = ['danh sach thiet bi', 'nhung thiet bi nao', 'thiet bi nao', 'thiet bi', 'list devices', 'list the devices', 'devices'];
/** Multi-word fillers go first so "làm ơn" never reads as the English verb "on". */
const FILLER_PHRASES = ['lam on', 'giup minh', 'giup toi', 'giup em', 'cho minh', 'cho toi', 'cho em', 'can you', 'could you', 'bay gio', 'hien tai', 'the nao', 'what is', 'is it'];
const FILLERS = new Set(
  'vega oi hey hi ok please pls giup cho minh toi em anh nhe nha ne voi vay a ah hay xin di thoi luon ngay nao the la co dang duoc cai chiec phong room what whats s it is in of an now right o trong cua bao nhieu gi'.split(' '),
);
const SPLIT = / (?:va|roi|sau do|xong|and|then) /;

class Clause {
  private s: string;
  constructor(text: string) {
    this.s = ` ${text} `;
  }
  /** Removes the first phrase of the list that occurs (lists are ordered longest first); returns it. */
  take(phrases: readonly string[]): string | null {
    for (const p of phrases) {
      const i = this.s.indexOf(` ${p} `);
      if (i >= 0) {
        this.s = `${this.s.slice(0, i)} ${this.s.slice(i + p.length + 1)}`;
        return p;
      }
    }
    return null;
  }
  /** Removes the first match of `re` (which must match surrounding spaces); returns its groups. */
  takeRe(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.s);
    if (m) this.s = `${this.s.slice(0, m.index)} ${this.s.slice(m.index + m[0].length)} `;
    return m;
  }
  /** Words that are left and are not filler. */
  rest(): string[] {
    return this.s.split(' ').filter((w) => w && !FILLERS.has(w));
  }
}

const byLength = (a: string, b: string) => b.length - a.length;

export interface LocalOptions {
  /** Room used when a sensor question names none. */
  defaultRoom: string;
}

/** Returns the tool calls for `text`, or null when the local router does not fully understand it. */
export function routeLocal(text: string, reg: Registry, opts: LocalOptions): ToolCall[] | null {
  const switches = reg.switches();
  // phrase → device keys (switches); phrase → room (room names, ids, aliases of non-switch devices)
  const devicePhrases = new Map<string, string[]>();
  const roomPhrases = new Map<string, string>();
  for (const d of reg.all()) {
    for (const n of [d.room, d.roomName ? fold(d.roomName) : '']) if (n) roomPhrases.set(n, d.room);
    if (d.on === undefined) for (const a of d.aliases) roomPhrases.set(fold(a), d.room);
  }
  for (const d of switches) {
    for (const p of new Set([...d.aliases.map(fold), d.id, `${fold(d.roomName ?? d.room)} ${d.id}`])) {
      if (p) devicePhrases.set(p, [...(devicePhrases.get(p) ?? []), d.key]);
    }
  }
  const deviceKeys = [...devicePhrases.keys()].sort(byLength);
  const roomKeys = [...roomPhrases.keys()].sort(byLength);

  const clauses = text
    .split(/[,;.!?\n]+/)
    .flatMap((part) => fold(part).split(SPLIT))
    .map((c) => c.trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;

  const calls: ToolCall[] = [];
  let lastOn: boolean | null = null; // "bật đèn và ổ cắm": the second clause borrows the verb
  for (const raw of clauses) {
    const c = new Clause(raw);
    while (c.take(FILLER_PHRASES));
    let understood = false;
    let info = false; // only read something: trailing question words may go

    for (const [call, phrases] of INFO) {
      if (c.take(phrases)) {
        calls.push(call);
        understood = info = true;
      }
    }
    if (c.take(CALENDAR)) {
      const day = c.take(['tiep theo', 'sap toi', 'next']) ? 'next' : c.take(['ngay mai', 'mai', 'tomorrow']) ? 'tomorrow' : (c.take(['hom nay', 'today']), 'today');
      calls.push({ name: 'calendar_list', args: { day } });
      understood = info = true;
    }
    if (c.take(CANCEL_REMINDER)) {
      const n = c.takeRe(/ (?:so )?(\d{1,6}) /);
      if (!n) return null; // which one? the LLM can ask
      calls.push({ name: 'cancel_reminder', args: { id: Number(n[1]) } });
      understood = true;
    }

    for (const [name, phrases] of CI) {
      if (c.take(phrases)) {
        calls.push({ name, args: {} });
        understood = true;
      }
    }

    for (const [name, phrases] of SCENES) {
      if (c.take(phrases)) {
        // "tập trung 45 phút", "focus for 1 hour"
        const d = name === 'focus' ? c.takeRe(/ (?:trong |for )?(\d{1,3}) (phut|p|minutes|minute|mins|min|tieng|gio|hours|hour|h) /) : null;
        const minutes = d ? Number(d[1]) * (/^(tieng|gio|hours|hour|h)$/.test(d[2]!) ? 60 : 1) : undefined;
        if (minutes !== undefined && (minutes < 1 || minutes > 180)) return null;
        calls.push({ name: 'run_scene', args: { name, ...(minutes && { minutes }) } });
        understood = true;
      }
    }

    for (const [metric, phrases] of METRICS) {
      if (!c.take(phrases)) continue;
      const roomPhrase = c.take(roomKeys);
      calls.push({ name: 'get_sensor', args: { metric, room: roomPhrase ? roomPhrases.get(roomPhrase)! : opts.defaultRoom } });
      understood = true;
    }

    const all = c.take(ALL) !== null;
    const on = c.take(ON) !== null;
    const off = c.take(OFF) !== null;
    if (on && off) return null;
    const devicePhrase = c.take(deviceKeys);
    // "có mail gì mới không": "mới" is not "mọi" (all) when the clause only reads something
    if (on || off || devicePhrase || (all && !info)) {
      const want: boolean | null = on ? true : off ? false : lastOn;
      if (want === null) return null;
      let keys = devicePhrase ? devicePhrases.get(devicePhrase)! : all ? switches.map((d) => d.key) : [];
      const roomPhrase = c.take(roomKeys);
      if (roomPhrase) keys = keys.filter((k) => reg.get(k)!.room === roomPhrases.get(roomPhrase));
      if (keys.length === 0 || (keys.length > 1 && !all)) return null; // nothing, or ambiguous: the LLM can ask
      for (const device of keys) calls.push({ name: 'set_device', args: { device, on: want } });
      c.take(['thiet bi', 'devices', 'device']); // "tắt hết thiết bị"
      lastOn = want;
      understood = true;
    }

    if (!understood && c.take(LIST)) {
      calls.push({ name: 'list_devices', args: {} });
      understood = true;
    }

    if (info && !calls.some((x) => x.name === 'set_device')) while (c.take(INFO_TAIL));
    if (c.rest().length > 0) return null;
    if (!understood) continue; // only filler ("Vega ơi,")
  }
  return calls.length > 0 ? calls : null;
}
