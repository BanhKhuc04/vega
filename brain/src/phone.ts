/**
 * Phone alerts (M10, brief 0014 P8–P9): what VEGA shows on its own also goes to ntfy on the Pi 3, which the owner's phone
 * subscribes to. Health problems always go; CI failures and reminders only when the owner is not home (the screen at the
 * desk already shows them); the morning briefing goes as a quiet one-liner. Plain HTTP, no library; a failure is kept for
 * `/status` and never breaks the command or notification that triggered it.
 */
import type { SceneOut } from './bus';

export interface PhoneConfig {
  url: string;
  token: string;
  topic: string;
}

export type PushLevel = 'urgent' | 'normal' | 'low';

export interface PhoneDeps {
  config: PhoneConfig;
  /** true = home, false = away, null = unknown (treated as away). */
  atHome(): boolean | null;
  log(msg: string): void;
  fetchImpl?: typeof fetch;
}

/** Which of VEGA's own screens reach the phone, and how loudly. null = not pushed. */
export function levelOf(s: SceneOut): PushLevel | null {
  if (s.id?.startsWith('health-')) return 'urgent';
  if (s.scene === 'alert') return 'normal';
  if (s.scene === 'briefing') return 'low';
  return null;
}

const PRIORITY: Record<PushLevel, number> = { urgent: 5, normal: 4, low: 2 };
const TAGS: Record<PushLevel, string[]> = { urgent: ['rotating_light'], normal: ['bell'], low: ['sunrise'] };

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export class PhonePush {
  /** The last failure ("HTTP 401", "timeout"…), null once a push goes through. */
  error: string | null = null;

  constructor(private readonly d: PhoneDeps) {}

  /** Sends `scene` (titled `label`) when its level and the owner's whereabouts call for it. Never throws. */
  async push(scene: SceneOut, label: string): Promise<void> {
    const level = levelOf(scene);
    if (!level || (level !== 'urgent' && this.d.atHome() === true)) return;
    const data = scene.data as Record<string, unknown> | undefined;
    // only the scene's own short text: never a coordinate, a mail body or a key (none of them is in an alert's `error`)
    const message = clip(typeof data?.error === 'string' && data.error ? data.error : (scene.status ?? label), 300);
    const body = JSON.stringify({ topic: this.d.config.topic, title: clip(label, 80), message, priority: PRIORITY[level], tags: TAGS[level] });
    await this.send(this.d.config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  }

  /**
   * While a failure is kept: asks ntfy whether it answers and takes the token again (GET /v1/account, nothing reaches the
   * phone). Without it the failure would stay in `/status` until the next push, which at home can be days away.
   */
  async recheck(): Promise<void> {
    if (this.error) await this.send(`${this.d.config.url}/v1/account`, { method: 'GET' });
  }

  private async send(url: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<void> {
    let failure: string | null;
    try {
      const r = await (this.d.fetchImpl ?? fetch)(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${this.d.config.token}` }, signal: AbortSignal.timeout(10_000) });
      failure = r.ok ? null : `HTTP ${r.status}`;
    } catch (e) {
      failure = (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message.slice(0, 80);
    }
    if (failure !== this.error) this.d.log(failure ? `[phone] push failed: ${failure}` : '[phone] pushes go through again');
    this.error = failure;
  }
}
