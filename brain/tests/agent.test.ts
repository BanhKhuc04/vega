import { describe, expect, it } from 'vitest';
import { LlmUnavailable } from '../src/llm';
import { chipLabel } from '../src/tools';
import { makeAgent } from './harness';

const owner = (text: string, id = 'UI-1') => ({ id, text, origin: 'owner' as const });

describe('Agent · local path', () => {
  it('"phòng mấy độ, bật đèn giúp": right temperature, light on, no LLM call', async () => {
    const t = makeAgent({ temp: 26.8 });
    const out = await t.agent.handle(owner('phòng mấy độ, bật đèn giúp'));
    expect(out).toMatchObject({ path: 'local', llmCalls: 0, answer: 'Bedroom 26.8°C · Living room light on' });
    expect(t.llm.calls).toBe(0);
    expect(t.sets).toEqual([{ device: 'livingroom/light', on: true }]);
    expect(t.results).toEqual([{ id: 'UI-1', text: 'Bedroom 26.8°C · Living room light on' }]);
    const last = t.scenes.at(-1)!;
    expect(last).toMatchObject({ scene: 'idle', data: { caption: 'Bedroom 26.8°C · Living room light on' } });
    const chips = t.thinks().at(-1)!.data!.chips!.map((c) => c.label);
    expect(chips).toEqual(['Parse intent', 'Local match', 'get_sensor temp bedroom', 'set_device livingroom/light']);
  });

  it('an offline device is reported, not switched', async () => {
    const t = makeAgent();
    t.registry.apply('vega/livingroom/light/availability', 'offline');
    expect((await t.agent.handle(owner('bật đèn'))).answer).toBe('Living room light is offline');
    expect(t.sets).toEqual([]);
  });

  it('said differently (M11): understood by meaning, no LLM; a high-risk plug still asks first', async () => {
    const t = makeAgent();
    expect(await t.agent.handle(owner('cho đèn sáng lên'))).toMatchObject({ path: 'local', llmCalls: 0 });
    expect(t.sets).toEqual([{ device: 'livingroom/light', on: true }]);
    expect(await t.agent.handle(owner('tắt ổ cắm bếp giúp, sợ cháy', 'UI-2'))).toMatchObject({ path: 'confirm', llmCalls: 0 });
    expect(t.llm.calls).toBe(0);
    expect(t.sets).toHaveLength(1);
  });

  it('the sleep scene turns low-risk lights off and takes the screen', async () => {
    const t = makeAgent();
    const out = await t.agent.handle(owner('đi ngủ'));
    expect(t.sets).toEqual([{ device: 'livingroom/light', on: false }]); // the high-risk plug is left alone
    expect(t.scenes.at(-1)).toMatchObject({ scene: 'sleep' });
    expect(out.answer).toBe('Sleep scene: 1 light off');
  });
});

describe('Agent · LLM path (mock)', () => {
  it('a sentence the local router does not know goes to the LLM, which calls the right tool; chips match the tools', async () => {
    const t = makeAgent({ temp: 27.2 });
    const out = await t.agent.handle(owner('với cái nóng thế này mình có nên mặc áo khoác không'));
    expect(out.path).toBe('llm');
    expect(out.calls).toEqual([{ name: 'get_sensor', args: { metric: 'temp' } }]);
    expect(out.answer).toBe('Bedroom 27.2°C');
    expect(out.llmCalls).toBe(2); // pick the tool, then write the answer
    const chips = t.thinks().at(-1)!.data!.chips!;
    const toolChips = chips.filter((c) => !c.label.startsWith('LLM ') && c.label !== 'Parse intent').map((c) => c.label);
    expect(toolChips).toEqual(out.calls.map(chipLabel));
    expect(chips.every((c) => c.state === 'done')).toBe(true);
  });

  it('an invalid tool call from the model is refused and reported back to it', async () => {
    const t = makeAgent({
      chat: async (_p, req) =>
        req.messages.at(-1)!.role === 'tool'
          ? { message: { role: 'assistant', content: 'sorry' }, usage: { in: 1, out: 1 } }
          : { message: { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'set_device', arguments: '{"device":"garage/door","on":true}' } }] }, usage: { in: 1, out: 1 } },
    });
    const out = await t.agent.handle(owner('mở cửa gara'));
    expect(out.calls).toEqual([]);
    expect(t.sets).toEqual([]);
    expect(out.answer).toBe('sorry');
  });

  it('no internet: the question gets "offline" at once, local commands keep working', async () => {
    const t = makeAgent({ chat: async () => Promise.reject(new LlmUnavailable('offline', 'fetch failed')) });
    const q = await t.agent.handle(owner('kể chuyện cười'));
    expect(q).toMatchObject({ path: 'offline', answer: expect.stringMatching(/^Offline/) });
    expect(t.scenes.at(-1)).toMatchObject({ scene: 'idle', data: { caption: expect.stringMatching(/^Offline/) } });
    const l = await t.agent.handle(owner('bật đèn'));
    expect(l).toMatchObject({ path: 'local', answer: 'Living room light on' });
  });

  it('without an AI provider only local commands work, and it says so', async () => {
    const t = makeAgent({ env: { LLM_ROUTER: 'none' } });
    expect(await t.agent.handle(owner('kể chuyện cười'))).toMatchObject({ path: 'no_llm', llmCalls: 0 });
    expect(t.llm.calls).toBe(0);
  });
});
