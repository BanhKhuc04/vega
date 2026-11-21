import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { authorized } from '../src/api';
import type { ApiDeps } from '../src/api';
import { loadConfig } from '../src/config';
import { routeLocal } from '../src/local';
import { Store, dayOf } from '../src/store';
import { voiceServer } from '../src/voice';
import { simRegistry } from '../bench/registry';

const TOKEN = 'console-token-0123456789';
let server: Server | null = null;
afterEach(() => void server?.close());

async function start(env: Record<string, string> = { CONSOLE_TOKEN: TOKEN }) {
  const config = loadConfig({ BRAIN_DB: ':memory:', ...env });
  const store = new Store(':memory:');
  const commands: string[] = [];
  const api: ApiDeps = {
    config,
    store,
    registry: simRegistry(),
    health: null,
    locator: null,
    command: async (text) => {
      commands.push(text);
      return { id: 'c1', answer: `ok: ${text}` };
    },
  };
  server = voiceServer({ config, store, log: () => {}, onSpent: () => {}, api });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, init: RequestInit & { token?: string | null } = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { ...(init.token !== null && { authorization: `Bearer ${init.token ?? TOKEN}` }), 'content-type': 'application/json' } });
  return { call, store, commands };
}

describe('authorized', () => {
  it('only the exact bearer token', () => {
    expect(authorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(authorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(authorized(TOKEN, TOKEN)).toBe(false);
    expect(authorized(undefined, TOKEN)).toBe(false);
  });
});

describe('Console API', () => {
  it('off without CONSOLE_TOKEN, or with a short one', async () => {
    const { call } = await start({});
    expect((await call('/api/overview')).status).toBe(503);
    expect(loadConfig({ CONSOLE_TOKEN: 'short' }).consoleToken).toBeNull();
  });

  it('401 without or with a wrong token', async () => {
    const { call } = await start();
    expect((await call('/api/overview', { token: null })).status).toBe(401);
    expect((await call('/api/overview', { token: 'console-token-wrong-000000' })).status).toBe(401);
  });

  it('overview, devices with a command phrase for switches, reminders, commands, costs, access', async () => {
    const { call, store } = await start();
    const now = Date.now();
    store.addReminder(now + 3_600_000, 'gọi mẹ', now);
    store.logUsage({ ts: now, commandId: 'x', task: 'chat', provider: 'mock', model: 'm', tokensIn: 1, tokensOut: 1, usd: 0.002 });
    store.logStt(now, 'groq', 'w', 3, 0.0001);
    store.logCommand({ id: 'x', ts: now, text: 'trên bàn có gì', origin: 'owner', path: 'local', answer: 'a', tools: ['look'], llmCalls: 0 });
    const o = await (await call('/api/overview')).json();
    expect(o).toMatchObject({ reminders: 1, health: null, presence: null, usage: { day: dayOf(now), calls: 1 } });
    const devices = (await (await call('/api/devices')).json()) as { key: string; phrase?: string }[];
    const phrase = devices.find((d) => d.key === 'livingroom/light')!.phrase!;
    // the Console switches a device by sending "bật <phrase>": the local router must map it to exactly that device
    expect(routeLocal(`bật ${phrase}`, simRegistry(), { defaultRoom: 'bedroom' })).toEqual([{ name: 'set_device', args: { device: 'livingroom/light', on: true } }]);
    expect(((await (await call('/api/reminders')).json()) as unknown[]).length).toBe(1);
    expect(((await (await call('/api/commands?limit=5')).json()) as unknown[]).length).toBe(1);
    const costs = (await (await call('/api/costs?days=7')).json()) as { rows: { task: string }[] };
    expect(costs.rows.map((r) => r.task).sort()).toEqual(['chat', 'stt']);
    expect(await (await call('/api/access')).json()).toMatchObject({ google: null, webSearch: false, cameraLastUsed: now });
  });

  it('400 on bad parameters, 404 on unknown routes', async () => {
    const { call } = await start();
    expect((await call('/api/commands?limit=0')).status).toBe(400);
    expect((await call('/api/commands?limit=abc')).status).toBe(400);
    expect((await call('/api/costs?days=999')).status).toBe(400);
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/overview', { method: 'DELETE' })).status).toBe(404);
  });

  it('POST /api/command runs a command as the owner; refuses empty or long text and bad JSON', async () => {
    const { call, commands } = await start();
    const r = await call('/api/command', { method: 'POST', body: JSON.stringify({ text: ' huỷ nhắc 3 ' }) });
    expect(await r.json()).toEqual({ id: 'c1', answer: 'ok: huỷ nhắc 3' });
    expect(commands).toEqual(['huỷ nhắc 3']);
    expect((await call('/api/command', { method: 'POST', body: JSON.stringify({ text: '' }) })).status).toBe(400);
    expect((await call('/api/command', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(501) }) })).status).toBe(400);
    expect((await call('/api/command', { method: 'POST', body: '{nope' })).status).toBe(400);
  });
});
