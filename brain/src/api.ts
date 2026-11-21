/**
 * JSON API of the Console (M8, brief 0013 B7–B9), on the brain's HTTP server next to /voice/stt; nginx forwards /api/*.
 * Every route needs `Authorization: Bearer <CONSOLE_TOKEN>`. It reads SQLite and the registry; the only thing it writes is
 * a command, which goes through the same queue, router and checks as one typed on the screen. It never runs a shell.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config';
import type { HealthWatch } from './health';
import type { Locator } from './locate';
import { fold } from './text';
import type { Registry } from './registry';
import { dayOf } from './store';
import type { Store } from './store';

const MAX_BODY = 4096;

export interface ApiDeps {
  config: Config;
  store: Store;
  registry: Registry;
  health: HealthWatch | null;
  locator: Locator | null;
  /** Runs a command as the owner (the Console's two actions: cancel a reminder, switch a device) and returns the answer. */
  command(text: string): Promise<{ id: string; answer: string }>;
  now?: () => number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Constant-time comparison of the bearer token. */
export function authorized(header: string | undefined, token: string): boolean {
  const m = /^Bearer (\S+)$/.exec(header ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Integer query parameter within [min, max]; the default when absent; null when present but wrong. */
function intParam(q: URLSearchParams, name: string, def: number, min: number, max: number): number | null {
  const v = q.get(name);
  if (v === null) return def;
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(undefined);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

/** Handles `/api/*`. */
export function handleApi(req: IncomingMessage, res: ServerResponse, d: ApiDeps): void {
  const token = d.config.consoleToken;
  if (!token) return json(res, 503, { error: 'off' });
  if (!authorized(req.headers.authorization, token)) return json(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url ?? '/', 'http://x');
  const now = (d.now ?? Date.now)();
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/overview': {
      const day = dayOf(now);
      const u = d.store.usageOn(day);
      const all = d.registry.all();
      const l = d.locator?.latest;
      return json(res, 200, {
        now,
        pi: d.registry.pi,
        usage: { day, usd: u.usd, budgetUsd: d.config.budgetUsdDay, calls: u.calls },
        health: d.health?.snapshot() ?? null,
        presence: l ? { home: d.locator!.atHome, device: l.device, updated: l.ts } : null,
        devices: { online: all.filter((x) => x.online).length, total: all.length },
        reminders: d.store.pendingReminders().length,
      });
    }
    case 'GET /api/devices':
      return json(
        res,
        200,
        d.registry.all().map((x) => ({
          key: x.key,
          room: x.roomName ?? x.room,
          name: x.name ?? x.aliases[0] ?? x.id,
          kind: x.kind,
          online: x.online,
          updated: x.updated,
          ...(x.on !== undefined && { on: x.on, risk: x.risk ?? 'high', phrase: `${fold(x.roomName ?? x.room)} ${x.id}` }),
          ...(x.tempC !== undefined && { tempC: x.tempC }),
          ...(x.humidity !== undefined && { humidity: x.humidity }),
          ...(x.co2Ppm !== undefined && { co2Ppm: x.co2Ppm }),
          ...(x.presence !== undefined && { presence: x.presence }),
        })),
      );
    case 'GET /api/reminders':
      return json(res, 200, d.store.pendingReminders());
    case 'GET /api/commands': {
      const limit = intParam(url.searchParams, 'limit', 100, 1, 500);
      if (limit === null) return json(res, 400, { error: 'limit must be 1-500' });
      return json(res, 200, d.store.lastCommands(limit));
    }
    case 'GET /api/costs': {
      const days = intParam(url.searchParams, 'days', 30, 1, 366);
      if (days === null) return json(res, 400, { error: 'days must be 1-366' });
      return json(res, 200, { budgetUsd: d.config.budgetUsdDay, rows: d.store.costsSince(dayOf(now - (days - 1) * 86_400_000)) });
    }
    case 'GET /api/access': {
      const c = d.config;
      const provider = (name: string | null) => (name ? (c.providers[name]?.model ?? name) : null);
      return json(res, 200, {
        google: c.google ? ['Calendar (read only)', 'Gmail headers (read only)'] : null,
        github: c.github ? c.github.repos : null,
        ai: { router: provider(c.tasks.router), chat: provider(c.tasks.chat), research: provider(c.tasks.research), vision: provider(c.tasks.vision) },
        speechToText: c.stt ? `${c.stt.provider} ${c.stt.model}` : null,
        webSearch: !!c.search,
        cameraLastUsed: d.store.lastToolUse('look'),
        phone: d.locator?.latest ? { device: d.locator.latest.device, updated: d.locator.latest.ts } : null,
      });
    }
    case 'POST /api/command':
      return void readJson(req).then(async (body) => {
        const text = (body as { text?: unknown } | undefined)?.text;
        if (typeof text !== 'string' || !text.trim() || text.length > 500) return json(res, 400, { error: 'text must be 1-500 characters' });
        try {
          json(res, 200, await d.command(text.trim()));
        } catch {
          json(res, 500, { error: 'command failed' });
        }
      });
    // the VEGA page open on the phone shares the browser's position (no OwnTracks needed); also usable from an iOS Shortcut
    case 'POST /api/location':
      return void readJson(req).then((body) => {
        const b = (body ?? {}) as { lat?: unknown; lon?: unknown; acc?: unknown };
        const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
        if (!num(b.lat, -90, 90) || !num(b.lon, -180, 180) || (b.acc !== undefined && !num(b.acc, 0, 100_000))) return json(res, 400, { error: 'lat, lon (and acc in metres) must be numbers' });
        if (!d.locator) return json(res, 503, { error: 'off' });
        d.locator.accept({ device: 'phone', lat: b.lat as number, lon: b.lon as number, accM: b.acc === undefined ? null : Math.round(b.acc as number), ts: now, regions: [] });
        json(res, 200, { home: d.locator.atHome });
      });
    default:
      return json(res, 404, { error: 'not found' });
  }
}
