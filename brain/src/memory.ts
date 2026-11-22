/**
 * What VEGA remembers (M9, brief 0015). Items live in SQLite on the Pi. Saying, asking about and forgetting them is handled
 * here without any AI. Towards a cloud AI only `relevant()` normal items go, and every known name goes out as its alias
 * (`Aliases`); private items never do.
 */
import { L } from './assistant';
import type { Lang } from './assistant';
import { kindOf, levelOf, namesIn } from './privacy';
import type { MemoryLevel, MemoryRow, Store } from './store';
import { clip, fold } from './text';
import type { ToolCall } from './tools';

const DAY = 86_400_000;
const EVENT_DAYS = 30;
const RELEVANT_MAX = 5;
/** About 400 tokens of memory per request, at most. */
const RELEVANT_CHARS = 1600;

/** Words that carry no topic: a question and a memory sharing only these are not related. */
const STOP = new Set(
  'toi minh ban la gi may nao dau khi bao ai co khong the nhe a oi vega cua va voi o trong luc da se dang thi ma nhu nay do vay roi cho de duoc mot cac nhung i my me you your is are was the a an of to in at on for and or what when where who how which do does did have has it that this'.split(' '),
);
const words = (s: string) => new Set(fold(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;
/** A time or day: with it, "remember …" asks for a reminder. */
const WHEN = /\d{1,2}\s*(?:giờ|gio|h|am|pm|:\d{2})(?:\s|$|[.,])|(?:^|\s)(?:lúc|vào lúc|ngày mai|sáng mai|chiều mai|tối mai|tối nay|chiều nay|tomorrow|tonight|at noon|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\s|$|[.,])/iu;
const QUESTION = /\?|(?:^|\s)(?:gì|mấy|nào|đâu|bao giờ|khi nào|ai|bao nhiêu|what|when|who|where|which|how)(?:\s|$)/iu;

/** Memory commands of the owner, read before the device router. null = not one. */
export function parseMemoryCommand(text: string): ToolCall | null {
  const t = text.trim().replace(/^(?:vega ơi|hey vega|vega)[,\s]+/iu, '');
  let m = /^(?:hãy\s+|làm ơn\s+)?(?:quên|xoá|xóa)\s+(?:hết|tất cả)(?:\s+(?:trí nhớ|những gì (?:bạn )?nhớ))?\s*[.!]?$|^forget everything\s*[.!]?$/iu.exec(t);
  if (m) return { name: 'forget_all', args: {} };
  m = /^(?:quên|forget)\s+(?:mục|item)\s*#?(\d{1,6})\s*[.!]?$/iu.exec(t);
  if (m) return { name: 'forget', args: { id: Number(m[1]) } };
  m = /^(?:mục|item)\s*#?(\d{1,6})\s+(riêng tư|bí mật|thường|private|normal)\s*[.!]?$/iu.exec(t);
  if (m) return { name: 'memory_level', args: { id: Number(m[1]), level: /^(riêng tư|bí mật|private)$/iu.test(m[2]!) ? 'private' : 'normal' } };
  // "quên mất tắt đèn", "quên tắt đèn rồi": the owner forgot something, VEGA must not; a forget by words is confirmed anyway
  m = /^(?:hãy\s+)?(?:quên|forget)\s+(?!mất\s|to\s)(?:đi\s+)?(?:là\s+|rằng\s+|that\s+|about\s+|chuyện\s+|điều\s+)?(.{2,200})$/iu.exec(t);
  if (m && !/\s(?:rồi|mất rồi)\s*[.!]?$/iu.test(t)) return { name: 'forget', args: { query: m[1]!.replace(/[.!]+$/, '').trim() } };
  if (/^(?:bạn|vega|em)?\s*(?:nhớ|biết)\s+(?:được\s+)?(?:gì|những gì)\s+về\s+(?:tôi|mình|tao|anh|chị)\s*\??$|^what do you (?:remember|know) about me\??$|^(?:bạn nhớ những gì|what do you remember)\??$/iu.test(t)) {
    return { name: 'memory_list', args: {} };
  }
  m = /^(?:hãy\s+|làm ơn\s+)?(ghi nhớ|nhớ giúp (?:tôi|mình)|nhớ bí mật(?: là| rằng)?|nhớ mãi(?: là| rằng)?|nhớ (?:là|rằng)|remember (?:that|this)|remember)\s*:?\s*(.{2,300})$/iu.exec(t);
  if (m) {
    const how = m[1]!.toLowerCase();
    let what = m[2]!.trim();
    // "remember to call mom at 5", "nhớ giúp tôi gọi mẹ lúc 5 giờ": a reminder, for the reminder parser or the AI's add_reminder
    if ((how === 'remember' || how.startsWith('nhớ giúp')) && !/^(?:là|rằng)\s/iu.test(what) && (/^to\s/iu.test(what) || WHEN.test(what))) return null;
    const secret = how.includes('bí mật') || /^(?:bí mật|secret(?:ly)?)\s*[:,]?\s*/iu.test(what) || /\s*\((?:bí mật|secret)\)$/iu.test(what);
    what = what.replace(/^(?:là|rằng)\s+/iu, '').replace(/^(?:bí mật|secret(?:ly)?)\s*[:,]?\s*/iu, '').replace(/\s*\((?:bí mật|secret)\)$/iu, '');
    return { name: 'remember', args: { text: clip(what, 300), ...(secret && { secret: true }), ...(how.includes('mãi') && { pinned: true }) } };
  }
  return null;
}

/** Real names ⇄ aliases for everything sent to a cloud AI (T5). */
export class Aliases {
  private readonly pairs: [string, string][];
  constructor(rows: { name: string | null; alias: string | null }[]) {
    // one item may teach several names: `name` and `alias` hold parallel lists, one per line. Longest first: "Nguyễn Văn Lan" before "Lan"
    this.pairs = rows
      .flatMap((r) => {
        const names = r.name?.split('\n') ?? [];
        const aliases = r.alias?.split('\n') ?? [];
        return names.flatMap((n, i): [string, string][] => (n && aliases[i] ? [[n, aliases[i]!]] : []));
      })
      .sort((a, b) => b[0].length - a[0].length);
  }
  get size(): number {
    return this.pairs.length;
  }
  list(): [string, string][] {
    return this.pairs;
  }
  hide(s: string): string {
    let out = s;
    // a name that is also an everyday word ("Mai" / "ngày mai") is only hidden as written; any other name in any case ("lan ơi")
    // shortcut: COMMON_WORDS is a short hand-made list; a lowercase "mai" meaning the person still goes out as is
    for (const [name, alias] of this.pairs) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, COMMON_WORDS.has(name.toLowerCase()) ? 'gu' : 'giu'), alias);
    return out;
  }
  reveal(s: string): string {
    let out = s;
    for (const [name, alias] of this.pairs) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(alias)}(?![\\p{L}\\p{N}])`, 'gu'), name);
    return out;
  }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Given names that are also common words: "mai" (tomorrow), "nam" (south), "hoa" (flower), "an toàn"… */
const COMMON_WORDS = new Set(
  'an bình công đông đức hà hải hạ hạnh hoa hoà hòa hồng hương khoa long mai minh nam ngọc phúc quang sơn tâm thanh thành thu trung vân việt xuân yên'.split(' '),
);

export class Memory {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  all(): MemoryRow[] {
    return this.store.memories(this.now());
  }

  aliases(): Aliases {
    return new Aliases(this.all());
  }

  remember(text: string, lang: Lang, opts: { secret?: boolean; pinned?: boolean } = {}): { ok: boolean; text: string } {
    const level = levelOf(text, opts);
    if (level === 'refuse') {
      return { ok: false, text: L(lang, 'Mình không nhớ mật khẩu, mã OTP, số thẻ, số tài khoản hay số giấy tờ. Hãy cất chúng trong trình quản lý mật khẩu.', 'I do not keep passwords, one-time codes, card, account or ID numbers. Keep them in a password manager.') };
    }
    const kind = kindOf(text);
    const rows = this.all();
    const known = new Map(new Aliases(rows).list().map(([n, a]) => [fold(n), a]));
    const used = new Set(known.values());
    const found = namesIn(text).map((f) => {
      const alias = known.get(fold(f.name)) ?? nextAlias(f.type, used);
      used.add(alias);
      return { name: f.name, alias };
    });
    const now = this.now();
    const row = this.store.addMemory({ kind, level, text, name: found.length ? found.map((f) => f.name).join('\n') : null, alias: found.length ? found.map((f) => f.alias).join('\n') : null, pinned: !!opts.pinned, created: now, expires: kind === 'event' && !opts.pinned ? now + EVENT_DAYS * DAY : null });
    const how = level === 'private' ? L(lang, ' (riêng tư: không gửi cho AI)', ' (private: never sent to an AI)') : '';
    return { ok: true, text: L(lang, `Đã nhớ #${row.id}: ${clip(text, 120)}${how}.`, `Remembered #${row.id}: ${clip(text, 120)}${how}.`) };
  }

  /** "bạn nhớ gì về tôi": everything, private included, shown to the owner only (never through an AI). */
  list(lang: Lang): string {
    const rows = this.all();
    if (!rows.length) return L(lang, 'Mình chưa nhớ gì về bạn. Nói "nhớ là …" để dặn mình.', 'I do not remember anything about you yet. Say "remember that …".');
    const items = rows.map((r) => `#${r.id} ${clip(r.text, 80)}${r.level === 'private' ? ' 🔒' : ''}`);
    return clip(L(lang, `Mình nhớ ${rows.length} điều: ${items.join(' · ')}`, `I remember ${rows.length} things: ${items.join(' · ')}`), 2000);
  }

  forget(target: { id?: number; query?: string }, lang: Lang): { ok: boolean; text: string } {
    const row = this.find(target);
    if (!row) return { ok: false, text: L(lang, 'Mình không thấy điều đó trong trí nhớ. Nói "bạn nhớ gì về tôi" để xem danh sách.', 'I cannot find that in my memory. Say "what do you remember about me" for the list.') };
    this.store.deleteMemory(row.id);
    return { ok: true, text: L(lang, `Đã quên #${row.id}: ${clip(row.text, 100)}.`, `Forgot #${row.id}: ${clip(row.text, 100)}.`) };
  }

  /** The item "quên mục 3" or "quên chuyện …" points at. */
  find(target: { id?: number; query?: string }): MemoryRow | undefined {
    if (target.id !== undefined) return this.all().find((r) => r.id === target.id);
    return target.query ? this.best(target.query, this.all(), 1) : undefined;
  }

  forgetAll(lang: Lang): string {
    const n = this.store.clearMemory();
    return L(lang, `Đã quên hết ${n} điều.`, `Forgot all ${n} things.`);
  }

  setLevel(id: number, level: MemoryLevel, lang: Lang): { ok: boolean; text: string } {
    const row = this.all().find((r) => r.id === id);
    if (!row) return { ok: false, text: L(lang, `Không có mục #${id}.`, `No item #${id}.`) };
    this.store.updateMemory(id, { level });
    return { ok: true, text: L(lang, `Mục #${id} giờ là ${level === 'private' ? 'riêng tư' : 'thường'}.`, `Item #${id} is now ${level}.`) };
  }

  /** A question the memory answers by itself ("tôi dậy mấy giờ"): the item, else null. */
  recall(question: string): MemoryRow | null {
    if (!QUESTION.test(question)) return null;
    const q = words(question);
    if (q.size === 0) return null;
    const hit = this.best(question, this.all(), 2);
    return hit && overlap(q, words(hit.text)) / q.size >= 0.5 ? hit : null;
  }

  /** Normal items related to `text`, at most 5 and about 400 tokens (T6). Private items never. */
  relevant(text: string): MemoryRow[] {
    const q = words(text);
    const scored = this.all()
      .filter((r) => r.level === 'normal')
      .map((r) => ({ r, n: overlap(q, words(r.text)) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || b.r.id - a.r.id);
    const out: MemoryRow[] = [];
    let chars = 0;
    for (const { r } of scored) {
      if (out.length >= RELEVANT_MAX || chars + r.text.length > RELEVANT_CHARS) break;
      out.push(r);
      chars += r.text.length;
    }
    return out;
  }

  /** The question is about something kept private (T11): the answer says that part stayed on the Pi. */
  touchesPrivate(text: string): boolean {
    const q = words(text);
    return this.all().some((r) => r.level === 'private' && overlap(q, words(r.text)) > 0);
  }

  private best(text: string, rows: MemoryRow[], min: number): MemoryRow | undefined {
    const q = words(text);
    let top: { r: MemoryRow; n: number } | undefined;
    for (const r of rows) {
      const n = overlap(q, words(r.text)) + ((r.name ?? '').split('\n').some((x) => x && q.has(fold(x))) ? 1 : 0);
      if (n >= min && (!top || n > top.n)) top = { r, n };
    }
    return top?.r;
  }
}

function nextAlias(type: 'person' | 'place', used: Set<string>): string {
  const prefix = type === 'person' ? 'Người' : 'Nơi';
  for (let i = 0; ; i++) {
    const letters = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`;
    if (!used.has(`${prefix} ${letters}`)) return `${prefix} ${letters}`;
  }
}
