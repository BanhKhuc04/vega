import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface FakeEvent {
  summary: string;
  /** ISO date-time, or `YYYY-MM-DD` for an all-day event. */
  start: string;
  location?: string;
}

/**
 * A small stand-in for Google: the OAuth consent page (redirects back with a code), the token endpoint (checks
 * PKCE, issues and refreshes tokens), Calendar events, Gmail list + metadata, and Open-Meteo.
 */
export async function fakeGoogle() {
  const clientId = 'client-123.apps.googleusercontent.com';
  const clientSecret = 'GOCSPX-test-secret';
  const refreshToken = '1//refresh-secret';
  const accessToken = 'ya29.access-secret';
  let events: FakeEvent[] = [];
  let mail: { from: string; subject: string }[] = [];
  let revoked = false;
  const challenges = new Map<string, string>();
  const seen: { method: string; path: string; auth?: string; body?: string }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      seen.push({ method: req.method!, path: url.pathname + url.search, ...(req.headers.authorization && { auth: req.headers.authorization }), ...(body && { body }) });
      const json = (o: unknown, status = 200) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(o));
      };
      if (url.pathname === '/auth') {
        // the "browser": the owner agrees at once
        const code = `code-${challenges.size + 1}`;
        challenges.set(code, url.searchParams.get('code_challenge') ?? '');
        res.statusCode = 302;
        res.setHeader('location', `${url.searchParams.get('redirect_uri')}?code=${code}&state=${url.searchParams.get('state')}`);
        return res.end();
      }
      if (url.pathname === '/token') {
        const f = new URLSearchParams(body);
        if (f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret) return json({ error: 'invalid_client' }, 401);
        if (f.get('grant_type') === 'authorization_code') {
          const want = challenges.get(f.get('code') ?? '');
          const got = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
          if (!want || want !== got) return json({ error: 'invalid_grant' }, 400);
          return json({ access_token: accessToken, expires_in: 3599, refresh_token: refreshToken, scope: 'calendar.readonly gmail.readonly' });
        }
        if (f.get('grant_type') === 'refresh_token') {
          if (revoked || f.get('refresh_token') !== refreshToken) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
          return json({ access_token: accessToken, expires_in: 3599 });
        }
        return json({ error: 'unsupported_grant_type' }, 400);
      }
      if (url.pathname === '/v1/forecast') {
        return json({ current: { temperature_2m: 24.4, weather_code: 3 }, daily: { temperature_2m_max: [29], temperature_2m_min: [22], precipitation_probability_max: [60], weather_code: [61] } });
      }
      if (req.headers.authorization !== `Bearer ${accessToken}`) return json({ error: { code: 401 } }, 401);
      if (/^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(url.pathname)) {
        const min = Date.parse(url.searchParams.get('timeMin')!);
        const max = Date.parse(url.searchParams.get('timeMax')!);
        const items = events
          .map((e) => ({ summary: e.summary, ...(e.location && { location: e.location }), start: e.start.length === 10 ? { date: e.start } : { dateTime: e.start } }))
          .filter((e) => {
            const t = e.start.dateTime ? Date.parse(e.start.dateTime) : new Date(`${e.start.date}T00:00`).getTime();
            return t >= min && t < max;
          });
        return json({ items });
      }
      if (url.pathname === '/gmail/v1/users/me/messages') return json({ messages: mail.map((_, i) => ({ id: `m${i}` })) });
      const m = /^\/gmail\/v1\/users\/me\/messages\/m(\d+)$/.exec(url.pathname);
      if (m) {
        if (url.searchParams.get('format') !== 'metadata') return json({ error: 'only metadata in this fake' }, 400);
        const x = mail[Number(m[1])]!;
        return json({ id: `m${m[1]}`, payload: { headers: [{ name: 'From', value: x.from }, { name: 'Subject', value: x.subject }] } });
      }
      json({ error: 'not found' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    clientId,
    clientSecret,
    refreshToken,
    accessToken,
    base,
    seen,
    /** Settings as loadConfig expects them. */
    env: (tokenFile: string) => ({ GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_TOKEN_FILE: tokenFile, GOOGLE_API_URL: base, GOOGLE_TOKEN_URL: `${base}/token`, GOOGLE_AUTH_URL: `${base}/auth`, WEATHER_LAT: '21.03', WEATHER_LON: '105.85', WEATHER_API_URL: base }),
    setEvents: (e: FakeEvent[]) => void (events = e),
    setMail: (m: { from: string; subject: string }[]) => void (mail = m),
    revoke: () => void (revoked = true),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A browser that follows the consent page's redirect back to the loopback server, like the owner clicking "Allow". */
export const fakeBrowser = async (url: string) => {
  const r = await fetch(url, { redirect: 'follow' });
  await r.text();
};
