/**
 * "Nhắc tôi 3 giờ chiều gọi mẹ" / "remind me in 10 minutes to stretch" → when + what (Brief 0006, G7).
 * Common forms are parsed here (no AI call); anything else goes to the LLM's `add_reminder` tool.
 */

const PREFIX =
  /^\s*(?:(?:hey\s+)?vegas?\s*(?:ơi|oi)?\s*[,.]?\s*)?(?:(?:hãy|hay|làm ơn|lam on|please)\s+)?(?:(?:nhắc|nhac)(?:\s+(?:nhở|nho))?(?:\s+(?:tôi|toi|mình|minh|em|anh|tớ))?|remind\s+me)(?=\s|$)\s*/i;
const END = String.raw`(?=$|[\s,.!?])`;
const UNIT = String.raw`(phút|phut|ph|p|giờ|gio|tiếng|tieng|h|minutes?|mins?|hours?|hrs?)`;
const REL = new RegExp(String.raw`(?:^|\s)(?:sau|trong|in|after)\s+(\d{1,4}|một|mot|an?|nửa|nua|half an?)\s*${UNIT}${END}(?:\s+(?:nữa|nua))?`, 'i');
const PERIOD = String.raw`(sáng|sang|trưa|trua|chiều|chieu|tối|toi|đêm|dem|am|pm|a\.m\.|p\.m\.)`;
const ABS = new RegExp(
  String.raw`(?:^|\s)((?:vào\s+|vao\s+)?(?:lúc|luc)\s+|at\s+)?(\d{1,2})(?:\s*(:|h|g|giờ|gio)\s*(\d{2}|rưỡi|ruoi)?)?(?:\s*(?:phút|phut))?(?:\s*${PERIOD})?(?:\s+(mai|nay))?${END}`,
  'gi',
);
const DAY = new RegExp(String.raw`(?:^|\s)(ngày mai|ngay mai|tomorrow|hôm nay|hom nay|today|(?:${PERIOD.slice(1, -1)})\s+(?:mai|nay))${END}`, 'i');

const MAX_AHEAD_MS = 366 * 86_400_000;

/** 12-hour clock + period of the day → 24-hour hour, or null if impossible ("13 giờ sáng"). */
function to24(h: number, period: string | null): number | null {
  if (!period) return h <= 23 ? h : null;
  if (h > 12) return null;
  const p = period.replace(/\./g, '');
  if (/^(sáng|sang|am)$/.test(p)) return h === 12 ? 0 : h;
  if (/^(trưa|trua)$/.test(p)) return h < 11 ? h + 12 : h;
  if (/^(đêm|dem)$/.test(p)) return h === 12 ? 0 : h >= 6 ? h + 12 : h;
  return h === 12 ? 12 : h + 12; // chiều, tối, pm
}

const wordNum = (w: string) => (/^\d+$/.test(w) ? Number(w) : /^(một|mot|an?)$/.test(w) ? 1 : 0.5);

/**
 * `undefined`: not a reminder request. `null`: a reminder request whose time is not understood (the LLM handles it).
 * `at` is always in the future and at most a year ahead.
 */
export function parseReminder(input: string, now: number): { at: number; text: string } | null | undefined {
  const s = input.normalize('NFC').trim();
  const pre = PREFIX.exec(s);
  if (!pre) return undefined;
  let rest = s.slice(pre[0].length);
  const cut = (m: RegExpExecArray | RegExpMatchArray) => (rest = `${rest.slice(0, m.index!)} ${rest.slice(m.index! + m[0].length)}`);

  let dayOffset = 0;
  let explicitDay = false;
  let period: string | null = null;
  const dm = DAY.exec(rest.toLowerCase());
  if (dm) {
    const w = dm[1]!;
    if (/mai|tomorrow/.test(w)) dayOffset = 1;
    explicitDay = true;
    const p = w.split(/\s+/)[0]!;
    if (!/ngày|ngay|hôm|hom|tomorrow|today/.test(p)) period = p;
    cut(dm);
  }

  let at: number | null = null;
  const rm = REL.exec(rest.toLowerCase());
  if (rm) {
    const n = wordNum(rm[1]!);
    const hours = /^(giờ|gio|tiếng|tieng|h|hours?|hrs?)$/.test(rm[2]!);
    if (n > 0) at = now + n * (hours ? 3_600_000 : 60_000);
    cut(rm);
  } else {
    for (const am of rest.toLowerCase().matchAll(ABS)) {
      const [, anchor, hh, sep, mm, per, nayMai] = am;
      if (!anchor && !sep && !per) continue; // a bare number ("gọi 2 người") is not a time
      const min = !mm ? 0 : /^(rưỡi|ruoi)$/.test(mm) ? 30 : Number(mm);
      const p = per ?? period;
      const h = to24(Number(hh), p);
      if (h === null || min > 59) return null;
      if (nayMai === 'mai') {
        dayOffset = 1;
        explicitDay = true;
      }
      const day = new Date(now);
      day.setDate(day.getDate() + dayOffset);
      // "lúc 3" at 14:00 means 15:00: without a period, try the afternoon hour too
      const hoursToTry = p || h >= 12 ? [h] : [h, h + 12];
      const on = (d: Date, hr: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr, min).getTime();
      at = hoursToTry.map((hr) => on(day, hr)).find((t) => t > now) ?? null;
      if (at === null && !explicitDay) {
        const next = new Date(day);
        next.setDate(next.getDate() + 1);
        at = on(next, hoursToTry[0]!);
      }
      cut(am);
      break;
    }
  }
  if (at === null || at <= now || at - now > MAX_AHEAD_MS) return null;
  const text = rest
    .replace(/\s+/g, ' ')
    .replace(/^(?:\s|[,.:]|để|de|là|la|rằng|rang|to|that|lúc|luc|at|vào|vao)+(?=\s|$)/gi, '')
    .replace(/^[\s,.:]+/, '')
    .replace(/(?:[\s,.!?]|nhé|nhe|nha|nhá|giúp|giup|với|voi|please)+$/gi, '')
    .trim();
  return { at, text: (text || 'Reminder').slice(0, 200) };
}
