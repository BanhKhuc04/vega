/**
 * Google Calendar + Gmail, read only (Brief 0006, G1–G4). Plain `fetch`, no SDK. The owner signs in once with
 * `npm run google-login` (OAuth "Desktop app", PKCE, loopback redirect); the refresh token lives in a file (mode 600)
 * next to the database. Tokens and the client secret only ever go in request bodies and headers, never in logs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { GoogleConfig } from './config';

export const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly'];
/** Unread mail in the Primary inbox of the last day (needs gmail.readonly: the metadata scope cannot filter). */
export const MAIL_QUERY = 'is:unread in:inbox category:primary newer_than:1d';

export class GoogleError extends Error {
  constructor(
    readonly kind: 'offline' | 'auth' | 'rate' | 'http',
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface CalEvent {
  title: string;
  /** Start, ms since epoch (local midnight for an all-day event). */
  start: number;
  allDay: boolean;
  location?: string;
}
export interface Mail {
  from: string;
  subject: string;
}

/** Access tokens from the stored refresh token; a revoked one (`invalid_grant`) turns Google off until a new login. */
export class GoogleAuth {
  private access: { token: string; expires: number } | null = null;
  /** Set once the refresh token was refused: no more calls (and no repeated errors) until the brain restarts. */
  dead = false;
  constructor(
    private readonly cfg: Pick<GoogleConfig, 'clientId' | 'clientSecret' | 'tokenFile' | 'tokenUrl'>,
    private readonly f: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when a login has been done (the token file exists). */
  hasLogin(): boolean {
    return existsSync(this.cfg.tokenFile);
  }

  async token(): Promise<string> {
    if (this.dead) throw new GoogleError('auth', 'Google sign-in expired: run npm run google-login');
    if (this.access && this.access.expires > this.now() + 60_000) return this.access.token;
    let refresh: string;
    try {
      refresh = (JSON.parse(readFileSync(this.cfg.tokenFile, 'utf8')) as { refresh_token: string }).refresh_token;
    } catch {
      throw new GoogleError('auth', 'no Google sign-in: run npm run google-login');
    }
    const body = new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' });
    const res = await send(this.f, this.cfg.tokenUrl, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) {
      if (json.error === 'invalid_grant' || res.status === 401) {
        this.dead = true;
        throw new GoogleError('auth', 'Google sign-in expired or revoked: run npm run google-login');
      }
      throw new GoogleError('http', `Google token endpoint ${res.status}`);
    }
    this.access = { token: json.access_token, expires: this.now() + (json.expires_in ?? 3600) * 1000 };
    return this.access.token;
  }
}

async function send(f: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new GoogleError('offline', `Google unreachable: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`);
  }
}

/** The two read-only APIs VEGA uses. */
export class GoogleApi {
  constructor(
    readonly auth: GoogleAuth,
    private readonly cfg: Pick<GoogleConfig, 'apiUrl' | 'calendars'>,
    private readonly f: Fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await send(this.f, `${this.cfg.apiUrl}${path}`, { headers: { authorization: `Bearer ${await this.auth.token()}`, accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401 || res.status === 403) throw new GoogleError(res.status === 403 && /rate|quota/i.test(await res.text().catch(() => '')) ? 'rate' : 'auth', `Google ${res.status} on ${path.split('?')[0]}`);
    if (res.status === 429) throw new GoogleError('rate', `Google rate limit on ${path.split('?')[0]}`);
    throw new GoogleError('http', `Google ${res.status} on ${path.split('?')[0]}`);
  }

  /** Events between two instants on the configured calendars, sorted by start. */
  async events(from: number, to: number): Promise<CalEvent[]> {
    const out: CalEvent[] = [];
    for (const cal of this.cfg.calendars) {
      const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '25' });
      const r = await this.get<{ items?: ApiEvent[] }>(`/calendar/v3/calendars/${encodeURIComponent(cal)}/events?${q}`);
      for (const e of r.items ?? []) {
        if (e.status === 'cancelled') continue;
        const allDay = !e.start?.dateTime;
        const start = allDay ? localMidnight(e.start?.date) : Date.parse(e.start!.dateTime!);
        if (!Number.isFinite(start)) continue;
        out.push({ title: (e.summary ?? '(no title)').trim() || '(no title)', start, allDay, ...(e.location && { location: e.location }) });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /** Unread mail in the Primary inbox: sender and subject only (`format=metadata`, the body is never fetched). */
  async unread(max = 6): Promise<Mail[]> {
    const list = await this.get<{ messages?: { id: string }[] }>(`/gmail/v1/users/me/messages?${new URLSearchParams({ q: MAIL_QUERY, maxResults: String(max) })}`);
    const out: Mail[] = [];
    for (const m of (list.messages ?? []).slice(0, max)) {
      const msg = await this.get<{ payload?: { headers?: { name: string; value: string }[] } }>(
        `/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      );
      const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
      out.push({ from: senderName(h('from')), subject: h('subject').trim() || '(no subject)' });
    }
    return out;
  }
}

interface ApiEvent {
  summary?: string;
  status?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
}

const localMidnight = (date?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
};

/** `"Lan Nguyen" <lan@x.com>` → `Lan Nguyen`; a bare address stays as it is. */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(from);
  return (m?.[1]?.trim() || from.replace(/[<>]/g, '').trim() || 'unknown').slice(0, 30);
}

export interface LoginOptions {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  tokenFile: string;
  /** Opens the consent page in a browser (the real one, or a stand-in in tests). */
  open(url: string): void | Promise<void>;
  f?: Fetch;
  timeoutMs?: number;
}

/**
 * One-time sign-in: a loopback server on 127.0.0.1 receives Google's redirect, the code is exchanged with the PKCE
 * verifier, and the refresh token is written to `tokenFile` (mode 600).
 */
export async function login(o: LoginOptions): Promise<{ scope: string }> {
  const f = o.f ?? fetch;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  let done!: (r: { code?: string; error?: string }) => void;
  const got = new Promise<{ code?: string; error?: string }>((r) => (done = r));
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (u.pathname !== '/callback') return void ((res.statusCode = 404), res.end());
    const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(ok ? 'VEGA is signed in to Google. You can close this tab.' : 'Sign-in failed. Close this tab and run npm run google-login again.');
    done(ok ? { code: u.searchParams.get('code')! } : { error: u.searchParams.get('error') ?? 'state mismatch' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`;
  try {
    const q = new URLSearchParams({ client_id: o.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
    await o.open(`${o.authUrl}?${q}`);
    const timeout = new Promise<{ error: string }>((r) => setTimeout(() => r({ error: 'timed out waiting for the browser' }), o.timeoutMs ?? 300_000).unref());
    const r = await Promise.race([got, timeout]);
    if (!('code' in r) || !r.code) throw new GoogleError('auth', `Google sign-in failed: ${r.error}`);
    const body = new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, code: r.code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' });
    const res = await send(f, o.tokenUrl, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const json = (await res.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string };
    if (!res.ok || !json.refresh_token) throw new GoogleError('auth', `Google refused the sign-in (${json.error ?? res.status})`);
    writeFileSync(o.tokenFile, JSON.stringify({ refresh_token: json.refresh_token, scope: json.scope ?? '', created: new Date().toISOString() }), { mode: 0o600 });
    chmodSync(o.tokenFile, 0o600); // the mode above only applies when the file is new
    return { scope: json.scope ?? '' };
  } finally {
    server.close();
  }
}
