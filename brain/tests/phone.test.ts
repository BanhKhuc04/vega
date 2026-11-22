import { describe, expect, it, vi } from 'vitest';
import { Assistant } from '../src/assistant';
import type { SceneOut } from '../src/bus';
import { loadConfig } from '../src/config';
import { PhonePush, levelOf } from '../src/phone';
import { Store } from '../src/store';
import { simRegistry } from '../bench/registry';
import { recordingBus } from './harness';

const health: SceneOut = { scene: 'alert', ttl: 300, level: 'high', status: 'System health', id: 'health-hot', data: { title: 'Pi too hot', ref: 'vega · pi', error: 'The Pi has been at 82 °C for 3 min.' } };
const ciFail: SceneOut = { scene: 'alert', ttl: 300, status: 'CI failed', data: { title: 'build failed', ref: 'vega · main', error: 'test: 2 failing' } };
const briefing = { scene: 'briefing', ttl: 60, status: 'Morning briefing', data: {} } as unknown as SceneOut;
const answer = { scene: 'locate', ttl: 30, data: { target: { lat: 21.02, lon: 105.85 } } } as unknown as SceneOut;

function phone(home: boolean | null, reply: () => Promise<Response> = async () => new Response('{}')) {
  const f = vi.fn(reply);
  const logs: string[] = [];
  const p = new PhonePush({ config: { url: 'https://vega-watch.example.ts.net', token: 'tk_secret123456', topic: 'vega-abc12345' }, atHome: () => home, log: (m) => logs.push(m), fetchImpl: f as unknown as typeof fetch });
  const sent = () => f.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string) as { topic: string; title: string; message: string; priority: number });
  return { p, f, logs, sent };
}

describe('levelOf', () => {
  it('health is urgent, other alerts normal, the briefing low, answers never', () => {
    expect(levelOf(health)).toBe('urgent');
    expect(levelOf(ciFail)).toBe('normal');
    expect(levelOf(briefing)).toBe('low');
    expect(levelOf(answer)).toBeNull();
  });
});

describe('PhonePush', () => {
  it('urgent: sent with priority 5 and the token, even when home', async () => {
    const x = phone(true);
    await x.p.push(health, 'Health: Pi too hot');
    const [url, init] = x.f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://vega-watch.example.ts.net');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tk_secret123456');
    expect(x.sent()).toEqual([{ topic: 'vega-abc12345', title: 'Health: Pi too hot', message: 'The Pi has been at 82 °C for 3 min.', priority: 5, tags: ['rotating_light'] }]);
  });

  it('home: CI failures and the briefing stay on the screen', async () => {
    const x = phone(true);
    await x.p.push(ciFail, 'CI failed');
    await x.p.push(briefing, 'Morning briefing');
    expect(x.f).not.toHaveBeenCalled();
  });

  it('away or unknown: CI failures go (priority 4), the briefing goes quietly (2)', async () => {
    for (const home of [false, null]) {
      const x = phone(home);
      await x.p.push(ciFail, 'CI failed');
      await x.p.push(briefing, 'Morning briefing');
      expect(x.sent().map((m) => m.priority)).toEqual([4, 2]);
    }
  });

  it('never sends an answer screen, so never a coordinate', async () => {
    const x = phone(false);
    await x.p.push(answer, 'where am I');
    expect(x.f).not.toHaveBeenCalled();
  });

  it('a failure is kept, logged once, never thrown; the next success clears it', async () => {
    let status = 401;
    const x = phone(false, async () => new Response('', { status }));
    await x.p.push(health, 'a');
    await x.p.push(health, 'b');
    expect(x.p.error).toBe('HTTP 401');
    expect(x.logs).toEqual(['[phone] push failed: HTTP 401']);
    status = 200;
    await x.p.push(health, 'c');
    expect(x.p.error).toBeNull();
    expect(x.logs.at(-1)).toBe('[phone] pushes go through again');
  });

  it('recheck: nothing while fine; while failing, a GET with the token clears it without reaching the phone', async () => {
    let up = true;
    const x = phone(false, async () => (up ? new Response('{}') : new Response('', { status: 502 })));
    await x.p.recheck();
    expect(x.f).not.toHaveBeenCalled();
    up = false;
    await x.p.push(health, 'a');
    await x.p.recheck();
    expect(x.p.error).toBe('HTTP 502');
    up = true;
    await x.p.recheck();
    expect(x.p.error).toBeNull();
    const [url, init] = x.f.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect([url, init.method, init.body]).toEqual(['https://vega-watch.example.ts.net/v1/account', 'GET', undefined]);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tk_secret123456');
    expect(x.logs.at(-1)).toBe('[phone] pushes go through again');
  });

  it('network down: error kept, no throw', async () => {
    const x = phone(false, async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(x.p.push(health, 'a')).resolves.toBeUndefined();
    expect(x.p.error).toBe('connect ECONNREFUSED');
  });

  it('the message never carries the token', async () => {
    const x = phone(false);
    await x.p.push(health, 'a');
    expect((x.f.mock.calls[0] as unknown as [string, RequestInit])[1].body).not.toContain('tk_secret');
  });
});

describe('config: NTFY_*', () => {
  const ok = { NTFY_URL: 'https://vega-watch.example.ts.net/', NTFY_TOKEN: 'tk_abcdefgh1234', NTFY_TOPIC: 'vega-abc12345' };
  it('reads the three settings, root URL without the trailing slash', () => {
    expect(loadConfig(ok).phone).toEqual({ url: 'https://vega-watch.example.ts.net', token: 'tk_abcdefgh1234', topic: 'vega-abc12345' });
  });
  it('off when unset; off with a warning when one is wrong', () => {
    expect(loadConfig({}).phone).toBeNull();
    for (const bad of [{ NTFY_URL: 'https://x.ts.net/vega-abc12345' }, { NTFY_TOKEN: 'secret' }, { NTFY_TOPIC: 'a b' }]) {
      const c = loadConfig({ ...ok, ...bad });
      expect(c.phone).toBeNull();
      expect(c.warnings.join(' ')).toMatch(/phone alerts are off/);
    }
  });
});

describe('Assistant.notify → phone', () => {
  it('pushes even during Focus, while the screen holds the alert', () => {
    const pushed: string[] = [];
    const rec = recordingBus();
    const a = new Assistant({ bus: rec.bus, registry: simRegistry(), store: new Store(':memory:'), config: loadConfig({ BRAIN_DB: ':memory:' }), push: (_s, label) => pushed.push(label) });
    a.startFocus(25);
    a.notify(health, 'Health: Pi too hot');
    expect(pushed).toEqual(['Health: Pi too hot']);
    expect(rec.scenes.filter((s) => s.scene === 'alert')).toEqual([]);
  });
});
