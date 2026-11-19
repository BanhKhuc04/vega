import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { GoogleConfig } from '../src/config';
import { GoogleApi, GoogleAuth, GoogleError, login, senderName } from '../src/google';
import { fetchWeather } from '../src/weather';
import { fakeBrowser, fakeGoogle } from './fakegoogle';

let g: Awaited<ReturnType<typeof fakeGoogle>>;
let cfg: GoogleConfig;

beforeEach(async () => {
  g = await fakeGoogle();
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'vega-g-')), 'google-token.json');
  cfg = loadConfig(g.env(tokenFile)).google!;
});
afterEach(() => g.close());

describe('google-login', () => {
  it('PKCE sign-in through the loopback redirect writes the refresh token to a file only the owner can read', async () => {
    const r = await login({ ...cfg, open: fakeBrowser });
    expect(r.scope).toContain('calendar.readonly');
    expect(JSON.parse(readFileSync(cfg.tokenFile, 'utf8')).refresh_token).toBe(g.refreshToken);
    if (process.platform !== 'win32') expect(statSync(cfg.tokenFile).mode & 0o777).toBe(0o600);
    const auth = g.seen.find((s) => s.path.startsWith('/auth'))!.path;
    expect(auth).toContain('code_challenge_method=S256');
    expect(auth).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A');
    expect(new URL(auth, 'http://x').searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly');
    // the secret and the code verifier travel in the POST body, never in a URL
    expect(g.seen.filter((s) => s.path.includes(g.clientSecret) || s.path.includes('code_verifier'))).toEqual([]);
  });

  it('a wrong state (another site redirecting to the loopback port) is refused', async () => {
    const hijack = async (url: string) => {
      const redirect = new URL(url).searchParams.get('redirect_uri')!;
      await fetch(`${redirect}?code=stolen&state=nope`);
    };
    await expect(login({ ...cfg, open: hijack })).rejects.toThrow(/state mismatch/);
  });
});

describe('GoogleApi', () => {
  beforeEach(() => writeFileSync(cfg.tokenFile, JSON.stringify({ refresh_token: g.refreshToken })));

  it('reads events (timed and all-day) and unread mail with metadata only', async () => {
    const now = Date.now();
    g.setEvents([
      { summary: 'Họp nhóm', start: new Date(now + 3_600_000).toISOString(), location: 'Phòng 302' },
      { summary: 'Sinh nhật Lan', start: new Date(now).toLocaleDateString('sv-SE') },
    ]);
    g.setMail([{ from: '"Lan Nguyen" <lan@example.com>', subject: 'Slide thứ 6' }]);
    const api = new GoogleApi(new GoogleAuth(cfg), cfg);
    const ev = await api.events(now - 86_400_000, now + 86_400_000);
    expect(ev.map((e) => [e.title, e.allDay])).toEqual([['Sinh nhật Lan', true], ['Họp nhóm', false]]);
    expect(ev[1]!.location).toBe('Phòng 302');
    expect(await api.unread()).toEqual([{ from: 'Lan Nguyen', subject: 'Slide thứ 6' }]);
    const gmail = g.seen.filter((s) => s.path.startsWith('/gmail/v1/users/me/messages/'));
    expect(gmail.length).toBe(1);
    expect(gmail.every((s) => s.path.includes('format=metadata'))).toBe(true);
    // one token refresh serves every call while it is valid
    expect(g.seen.filter((s) => s.path === '/token').length).toBe(1);
  });

  it('a revoked refresh token turns Google off: one error, then no more calls', async () => {
    g.revoke();
    const auth = new GoogleAuth(cfg);
    const api = new GoogleApi(auth, cfg);
    await expect(api.unread()).rejects.toMatchObject({ kind: 'auth' });
    expect(auth.dead).toBe(true);
    const calls = g.seen.length;
    await expect(api.unread()).rejects.toBeInstanceOf(GoogleError);
    expect(g.seen.length).toBe(calls);
  });

  it('no token file → a clear error, nothing sent', async () => {
    const api = new GoogleApi(new GoogleAuth({ ...cfg, tokenFile: join(tmpdir(), 'nope-vega.json') }), cfg);
    await expect(api.events(0, 1)).rejects.toThrow(/google-login/);
    expect(g.seen).toEqual([]);
  });
});

describe('config and helpers', () => {
  it('needs both client id and secret; Google URLs must be https or localhost', () => {
    expect(loadConfig({ GOOGLE_CLIENT_ID: 'x' }).google).toBeNull();
    expect(loadConfig({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_API_URL: 'http://evil.example' }).google).toBeNull();
    const c = loadConfig({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', BRAIN_DB: '/data/brain.db' }).google!;
    expect(c.tokenFile.replace(/\\/g, '/')).toBe('/data/google-token.json');
    expect(c.calendars).toEqual(['primary']);
  });

  it('sender names', () => {
    expect(senderName('"Lan Nguyen" <lan@x.com>')).toBe('Lan Nguyen');
    expect(senderName('GitHub <noreply@github.com>')).toBe('GitHub');
    expect(senderName('bob@x.com')).toBe('bob@x.com');
  });

  it('weather from Open-Meteo', async () => {
    const w = await fetchWeather(loadConfig(g.env('x')).weather!);
    expect(w).toEqual({ tempC: 24.4, minC: 22, maxC: 29, rainPct: 60, code: 61 });
  });
});
