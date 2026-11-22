/**
 * Privacy level of a memory item (M9, brief 0015 T3–T4), decided on the Pi with word lists: no AI is asked, since asking
 * one would send the very text being judged. `refuse`: never stored (passwords, card and ID numbers, keys). `private`:
 * stored, never sent to a cloud AI. `normal`: may be sent when relevant, with names swapped for aliases. When unsure,
 * private: a weaker answer is better than a leak.
 */
import { fold } from './text';
import type { MemoryKind, MemoryLevel } from './store';

/** Folded match: for phrases that cannot be mistaken once the accents are gone ("benh vien", "password"). */
const has = (f: string, words: readonly string[]) => words.some((w) => ` ${f} `.includes(` ${w} `));
/** Match with the accents kept: Vietnamese single words collide once folded ("nợ"/"nó", "bạn"/"bàn", "cô"/"có"). */
const hasExact = (text: string, words: readonly string[]) => {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return words.some((w) => t.includes(` ${w} `));
};

const REFUSE = [
  'mat khau', 'mat ma', 'password', 'passwords', 'passcode', 'otp', 'ma otp', 'ma xac thuc', 'ma xac nhan', 'ma pin', 'pin',
  'so the', 'the tin dung', 'the ngan hang', 'card number', 'credit card', 'cvv', 'stk', 'so tai khoan', 'tai khoan ngan hang',
  'bank account', 'cccd', 'cmnd', 'can cuoc', 'ho chieu', 'passport', 'api key', 'token', 'secret key', 'private key',
  'seed phrase', 'khoa bi mat',
];
const PRIVATE = [
  'benh vien', 'dieu tri', 'bac si', 'tram cam', 'lo au', 'ung thu', 'mang thai', 'co thai', 'phau thuat', 'di ung', 'health', 'sick',
  'illness', 'disease', 'doctor', 'hospital', 'medicine', 'medication', 'therapy', 'pregnant', 'surgery', 'allergy', 'allergic',
  'depression', 'anxiety', 'thu nhap', 'chi tieu', 'tiet kiem', 'dau tu', 'co phieu', 'salary', 'debt', 'loan', 'money', 'income',
  'savings', 'invest', 'stocks', 'dia chi', 'so nha', 'so dien thoai', 'sdt', 'address', 'street', 'phone number', 'lives at',
  'live at', 'ton giao', 'chinh tri', 'religion', 'politics', 'nguoi yeu', 'ban gai', 'ban trai', 'ly hon', 'chia tay', 'hen ho',
  'girlfriend', 'boyfriend', 'divorce', 'dating', 'crush', 'bi mat', 'rieng tu', 'secret', 'private', 'dung ke', 'khong ai biet',
];
const PRIVATE_EXACT = ['bệnh', 'ốm', 'thuốc', 'viện', 'khám', 'tiền', 'lương', 'nợ', 'vay', 'đường', 'phường', 'quận', 'huyện', 'đạo', 'đảng'];
const PEOPLE = ['mother', 'mom', 'father', 'dad', 'brother', 'sister', 'wife', 'husband', 'son', 'daughter', 'friend', 'colleague', 'boss', 'neighbour', 'neighbor', 'grandma', 'grandpa', 'uncle', 'aunt', 'cousin', 'dong nghiep', 'hang xom'];
const PEOPLE_EXACT = ['mẹ', 'bố', 'ba', 'cha', 'anh', 'chị', 'em', 'vợ', 'chồng', 'con', 'ông', 'bà', 'cháu', 'cô', 'chú', 'bác', 'dì', 'cậu', 'mợ', 'thím', 'bạn', 'sếp'];
const ROUTINE = ['moi ngay', 'hang ngay', 'moi sang', 'moi toi', 'hang tuan', 'cuoi tuan', 'day luc', 'ngu luc', 'every day', 'every morning', 'every night', 'usually', 'always', 'weekends', 'wake up', 'go to bed'];
const ROUTINE_EXACT = ['thường', 'luôn', 'thứ'];
const EVENT = ['hom nay', 'hom qua', 'hom kia', 'tuan truoc', 'thang truoc', 'today', 'yesterday', 'last week', 'last month', 'just'];
const EVENT_EXACT = ['vừa', 'đã'];

/** Long digit runs are card, account, ID or phone numbers: never stored. */
const DIGITS = /\d[\d .-]{7,}\d/;

export function levelOf(text: string, opts: { secret?: boolean } = {}): MemoryLevel | 'refuse' {
  const f = fold(text);
  if (has(f, REFUSE) || DIGITS.test(text)) return 'refuse';
  if (opts.secret || has(f, PRIVATE) || hasExact(text, PRIVATE_EXACT) || kindOf(text) === 'person') return 'private';
  return 'normal';
}

export function kindOf(text: string): MemoryKind {
  const f = fold(text);
  if (has(f, PEOPLE) || hasExact(text, PEOPLE_EXACT) || /(?:^|\s)(?:tên|named|called)\s/iu.test(text)) return 'person';
  if (has(f, ROUTINE) || hasExact(text, ROUTINE_EXACT) || /\d{1,2}\s*(?:giờ|gio|h|g|am|pm|:\d{2})(?:\s|$|[.,])/iu.test(text)) return 'routine';
  if (has(f, EVENT) || hasExact(text, EVENT_EXACT)) return 'event';
  return 'fact';
}

// A capitalised word: \p{Lu}, never an [A-Ỹ] range (it holds lowercase "đ", "ấ"…) and never the `i` flag (it makes \p{Lu}
// match lowercase too). So "anh đi làm" teaches no name "đi".
const CAP = '\\p{Lu}\\p{L}*';
/** The words as written, or with the first letter capitalised (start of a sentence). */
const either = (words: string[]) => words.map((w) => `[${w[0]!.toUpperCase()}${w[0]}]${w.slice(1)}`).join('|');
/** Not inside a word: the "em" of "xem" or "kem" is no kin word. */
const START = '(?<![\\p{L}\\p{N}])';
const NAME_RE = [
  new RegExp(`${START}(?:${either(['tên là', 'tên', 'named', 'called'])})\\s+(${CAP}(?:\\s+${CAP}){0,2})`, 'u'),
  new RegExp(`${START}(?:${either(['anh', 'chị', 'em', 'cô', 'chú', 'bác', 'ông', 'bà', 'bạn', 'cậu', 'dì', 'mợ', 'thím'])})\\s+(${CAP}(?:\\s+${CAP}){0,2})`, 'u'),
];
const PLACE_RE = new RegExp(
  `${START}(?:${either(['công ty', 'trường', 'quán', 'nhà hàng', 'bệnh viện', 'viện', 'phòng khám', 'company', 'school', 'hospital', 'clinic', 'cafe'])})\\s+(${CAP}(?:\\s+(?:${CAP}|\\d+)){0,3})`,
  'u',
);

/** The person and place names an item teaches, as written (capitalised), with their type. */
export function namesIn(text: string): { name: string; type: 'person' | 'place' }[] {
  const out: { name: string; type: 'person' | 'place' }[] = [];
  const add = (name: string, type: 'person' | 'place') => out.some((x) => x.name === name) || out.push({ name, type });
  for (const re of NAME_RE) for (const m of text.matchAll(new RegExp(re.source, 'gu'))) if (m[1]) add(m[1].trim(), 'person');
  for (const m of text.matchAll(new RegExp(PLACE_RE.source, 'gu'))) if (m[1]) add(m[1].trim(), 'place');
  return out;
}
