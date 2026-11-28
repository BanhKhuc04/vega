import { afterEach, describe, expect, it } from 'vitest';
import type { ChatFn } from '../src/agent';
import { LlmUnavailable, chat } from '../src/llm';
import { fakeOllama } from './fakeollama';
import { makeAgent } from './harness';

const owner = (text: string, id = 'UI-1') => ({ id, text, origin: 'owner' as const });
/** A sentence the local router does not know: the router picks get_sensor, then the answer is written. */
const ASK = 'trong phòng có oi bức nóng nực lắm không';

/** Real HTTP to the fake PC, the mock for the cloud; records who answered each turn. `cloudDown`: no internet. */
function recorder(opts: { cloudDown?: boolean } = {}) {
  const who: string[] = [];
  const fn: ChatFn = (p, req, o) => {
    who.push(p.name);
    if (opts.cloudDown && p.name !== 'ollama') return Promise.reject(new LlmUnavailable('offline', `${p.name}: fetch failed`));
    return chat(p, req, o);
  };
  return { who, fn };
}

let pc: Awaited<ReturnType<typeof fakeOllama>> | null = null;
afterEach(async () => {
  await pc?.close();
  pc = null;
});
/** The PC with Ollama; `off`: it was there once, now switched off (the port refuses). */
async function thePc(off = false) {
  const p = await fakeOllama();
  if (off) await p.close();
  else pc = p;
  return p;
}

describe('M15 · AI on the PC (brief 0019)', () => {
  it('budget spent and the PC on: the PC model answers, free, and the screen shows LOCAL AI', async () => {
    const p = await thePc();
    const r = recorder();
    const t = makeAgent({ env: p.env, config: { budgetUsdDay: 0 }, chat: r.fn, temp: 27.2 });
    const out = await t.agent.handle(owner(ASK));
    expect(out).toMatchObject({ path: 'llm', answer: 'Bedroom 27.2°C', llmCalls: 2 });
    expect(r.who).toEqual(['ollama', 'ollama']); // the cloud is never asked
    expect(t.results).toEqual([{ id: 'UI-1', text: 'Bedroom 27.2°C', localAi: true }]);
    expect(t.usage.at(-1)).toMatchObject({ spentUsd: 0, calls: 2 });
    expect(t.thinks().flatMap((s) => s.data!.chips!.map((c) => c.label))).not.toContain('BUDGET');
  });

  it('budget spent and the PC off: today\'s behaviour, local commands only', async () => {
    const p = await thePc(true);
    const r = recorder();
    const t = makeAgent({ env: p.env, config: { budgetUsdDay: 0 }, chat: r.fn });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'budget', answer: 'Daily AI budget reached: local commands only.', llmCalls: 0 });
    expect(r.who).toEqual([]);
    expect(t.results[0]).not.toHaveProperty('localAi');
    expect(await t.agent.handle(owner('bật đèn', 'UI-2'))).toMatchObject({ path: 'local', answer: 'Living room light on' });
  });

  it('no internet and the PC on: the PC answers, and for a minute the cloud is not even tried', async () => {
    const p = await thePc();
    const r = recorder({ cloudDown: true });
    let now = Date.now();
    const t = makeAgent({ env: p.env, chat: r.fn, temp: 27.2, deps: { now: () => now } });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'llm', answer: 'Bedroom 27.2°C' });
    expect(r.who).toEqual(['mock', 'ollama', 'ollama']);
    expect(t.results[0]).toMatchObject({ localAi: true });
    r.who.length = 0;
    now += 30_000;
    await t.agent.handle(owner(ASK, 'UI-2'));
    expect(r.who).toEqual(['ollama', 'ollama']);
    now += 61_000; // the internet may be back: the cloud picks the tools again
    r.who.length = 0;
    await t.agent.handle(owner(ASK, 'UI-3'));
    expect(r.who).toEqual(['mock', 'ollama', 'ollama']);
  });

  it('no internet and the PC off: "offline" as today', async () => {
    const p = await thePc(true);
    const r = recorder({ cloudDown: true });
    const t = makeAgent({ env: p.env, chat: r.fn });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'offline', answer: expect.stringMatching(/^Offline/) });
    expect(r.who).toEqual(['mock']);
  });

  it('cloud fine and the PC on: the cloud picks the tools, the PC writes the answer', async () => {
    const p = await thePc();
    const r = recorder();
    const t = makeAgent({ env: p.env, chat: r.fn, temp: 27.2 });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'llm', answer: 'Bedroom 27.2°C', llmCalls: 2 });
    expect(r.who).toEqual(['mock', 'ollama']);
    expect(t.results[0]).toMatchObject({ localAi: true });
    expect(await t.agent.handle(owner('bật đèn', 'UI-2'))).toMatchObject({ path: 'local' });
    expect(t.results[1]).not.toHaveProperty('localAi'); // a local command: the chip goes away
  });

  it('cloud fine and the PC off: the cloud does everything, as today', async () => {
    const p = await thePc(true);
    const r = recorder();
    const t = makeAgent({ env: p.env, chat: r.fn, temp: 27.2 });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'llm', answer: 'Bedroom 27.2°C' });
    expect(r.who).toEqual(['mock', 'mock']);
    expect(t.results[0]).not.toHaveProperty('localAi');
  });

  it('the PC model fails mid-answer: that turn again on the cloud, and the PC counts as off', async () => {
    const p = await thePc();
    p.state.failChat = true;
    const r = recorder();
    const t = makeAgent({ env: p.env, chat: r.fn, temp: 27.2 });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'llm', answer: 'Bedroom 27.2°C' });
    expect(r.who).toEqual(['mock', 'ollama', 'mock']);
    expect(t.results[0]).not.toHaveProperty('localAi');
    r.who.length = 0;
    await t.agent.handle(owner(ASK, 'UI-2'));
    expect(r.who).toEqual(['mock', 'mock']);
  });

  it('no cloud provider at all: the PC does everything while on, "no AI" while off', async () => {
    const p = await thePc();
    const r = recorder();
    const t = makeAgent({ env: { ...p.env, LLM_ROUTER: 'none' }, chat: r.fn, temp: 27.2 });
    expect(await t.agent.handle(owner(ASK))).toMatchObject({ path: 'llm', answer: 'Bedroom 27.2°C' });
    expect(r.who).toEqual(['ollama', 'ollama']);
    const off = await thePc(true);
    const t2 = makeAgent({ env: { ...off.env, LLM_ROUTER: 'none' }, chat: r.fn });
    expect(await t2.agent.handle(owner(ASK))).toMatchObject({ path: 'no_llm', llmCalls: 0 });
  });

  it('the PC is probed at most once a minute', async () => {
    const p = await thePc();
    let now = Date.now();
    const t = makeAgent({ env: p.env, temp: 27.2, deps: { now: () => now } });
    await t.agent.handle(owner(ASK));
    await t.agent.handle(owner(ASK, 'UI-2'));
    expect(p.hits.models).toBe(1);
    now += 61_000;
    await t.agent.handle(owner(ASK, 'UI-3'));
    expect(p.hits.models).toBe(2);
  });
});
