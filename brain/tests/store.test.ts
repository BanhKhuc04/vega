import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, dayOf } from '../src/store';
import { makeAgent } from './harness';

const owner = (text: string, id: string) => ({ id, text, origin: 'owner' as const });

describe('Store', () => {
  it('keeps commands and LLM usage on disk, sums cost per local day', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vega-brain-'));
    const path = join(dir, 'brain.db');
    const t0 = new Date(2026, 10, 18, 23, 59).getTime();
    const s = new Store(path);
    s.logUsage({ ts: t0, commandId: 'a', task: 'router', provider: 'mock', model: 'm', tokensIn: 10, tokensOut: 2, usd: 0.01 });
    s.logUsage({ ts: t0 + 120_000, commandId: 'b', task: 'router', provider: 'mock', model: 'm', tokensIn: 10, tokensOut: 2, usd: 0.02 }); // next day
    s.logCommand({ id: 'a', ts: t0, text: 'x', origin: 'owner', path: 'llm', answer: 'y', tools: ['list_devices'], llmCalls: 1 });
    s.close();
    const again = new Store(path);
    expect(again.spentUsd(dayOf(t0))).toBeCloseTo(0.01, 10);
    expect(again.spentUsd(dayOf(t0 + 120_000))).toBeCloseTo(0.02, 10);
    expect(again.llmCallsFor('a')).toBe(1);
    expect(again.lastCommands()).toEqual([{ id: 'a', ts: t0, text: 'x', origin: 'owner', path: 'llm', answer: 'y', tools: ['list_devices'], llmCalls: 1 }]);
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('cost ledger and daily budget', () => {
  it('every LLM call is one ledger row with tokens and USD; local commands have none', async () => {
    const t = makeAgent();
    await t.agent.handle(owner('phòng mấy độ, bật đèn giúp', 'L-1'));
    await t.agent.handle(owner('ngoài ban công không khí có trong lành không', 'Q-1'));
    expect(t.store.llmCallsFor('L-1')).toBe(0);
    expect(t.store.llmCallsFor('Q-1')).toBe(2);
    expect(t.store.spentUsd(dayOf(Date.now()))).toBeGreaterThan(0);
    expect(t.store.lastCommands().map((c) => [c.id, c.path, c.llmCalls])).toEqual([
      ['Q-1', 'llm', 2],
      ['L-1', 'local', 0],
    ]);
  });

  it('over the daily cap: local only, BUDGET chip once a day; local commands still work', async () => {
    let now = new Date(2026, 10, 18, 9, 0).getTime();
    const t = makeAgent({ config: { budgetUsdDay: 0.000001 }, deps: { now: () => now } });
    const first = await t.agent.handle(owner('kể chuyện cười', 'Q-1')); // spends past the cap
    expect(first.path).toBe('llm');
    const n = t.llm.calls;
    const q2 = await t.agent.handle(owner('trời hôm nay có đẹp không', 'Q-2'));
    const q3 = await t.agent.handle(owner('kể chuyện ma', 'Q-3'));
    expect(t.llm.calls).toBe(n); // no further LLM calls
    expect(q2).toMatchObject({ path: 'budget', answer: 'Daily AI budget reached: local commands only.' });
    expect(q3.path).toBe('budget');
    const budgetChips = t.thinks().filter((s) => s.data?.chips?.some((c) => c.label === 'BUDGET'));
    expect(budgetChips).toHaveLength(1);
    expect(await t.agent.handle(owner('bật đèn', 'L-1'))).toMatchObject({ path: 'local', answer: 'Living room light on' });
    now += 24 * 3600_000; // a new day: the AI is back
    expect((await t.agent.handle(owner('kể chuyện cười', 'Q-4'))).path).toBe('llm');
  });
});
