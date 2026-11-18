import { fold } from './text';

/** Sliding-window rate limit: at most `max` accepted commands in any `windowMs`. */
export class RateLimiter {
  private hits: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Records a command if allowed; otherwise returns the seconds until the next one would be. */
  take(now: number): { ok: true } | { ok: false; retryInS: number } {
    this.hits = this.hits.filter((t) => t > now - this.windowMs);
    if (this.hits.length >= this.max) return { ok: false, retryInS: Math.max(1, Math.ceil((this.hits[0]! + this.windowMs - now) / 1000)) };
    this.hits.push(now);
    return { ok: true };
  }
}

const YES = new Set(['yes', 'y', 'ok', 'okay', 'confirm', 'sure', 'co', 'dong y', 'xac nhan', 'chac chan', 'lam di', 'u', 'uh', 'vang', 'da']);
const NO = new Set(['no', 'n', 'cancel', 'stop', 'khong', 'huy', 'thoi', 'dung', 'dung lai', 'bo qua']);

/** The owner's reply to a confirmation prompt. */
export function reply(text: string): 'yes' | 'no' | null {
  const t = fold(text).replace(/\b(vega|oi|nhe|nha|a)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return YES.has(t) ? 'yes' : NO.has(t) ? 'no' : null;
}
