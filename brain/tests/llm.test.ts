import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { MOCK, loadConfig } from '../src/config';
import type { Provider } from '../src/config';
import { LlmUnavailable, chat, costUsd } from '../src/llm';
import { mockChat } from '../src/mock';
import { chipLabel, parseToolCall, toolSpecs } from '../src/tools';
import { simRegistry } from '../bench/registry';

describe('loadConfig', () => {
  it('defaults: no LLM, local only', () => {
    const c = loadConfig({});
    expect(c.tasks).toEqual({ router: null, chat: null });
    expect(c).toMatchObject({ defaultRoom: 'bedroom', budgetUsdDay: 0.2, ratePerMin: 10, mqttUrl: 'mqtt://localhost:1883' });
    expect(Object.keys(c.providers)).toEqual(['mock']);
  });

  it('providers come from LLM_<NAME>_* with presets; chat follows router unless set', () => {
    const c = loadConfig({
      LLM_ROUTER: 'deepseek',
      LLM_DEEPSEEK_API_KEY: 'sk-test',
      LLM_DEEPSEEK_MODEL: 'some-model',
      LLM_DEEPSEEK_PRICE_IN: '0.27',
      LLM_DEEPSEEK_PRICE_OUT: '1.1',
      LLM_LOCAL_BASE_URL: 'http://localhost:11434/v1/',
      LLM_LOCAL_MODEL: 'qwen',
      LLM_LOCAL_PRICE_IN: '0',
      LLM_LOCAL_PRICE_OUT: '0',
    });
    expect(c.providers.deepseek).toEqual({ name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'some-model', priceIn: 0.27, priceOut: 1.1, api: 'chat', maxOut: 512 });
    expect(c.providers.local!.baseUrl).toBe('http://localhost:11434/v1');
    expect(c.tasks).toEqual({ router: 'deepseek', chat: 'deepseek' });
    expect(c.warnings).toEqual([]);
  });

  it('refuses providers it could not account for or would leak a key to', () => {
    const c = loadConfig({
      LLM_ROUTER: 'openai',
      LLM_OPENAI_API_KEY: 'sk-x',
      LLM_OPENAI_MODEL: 'm', // no prices
      LLM_EVIL_BASE_URL: 'http://example.com/v1',
      LLM_EVIL_MODEL: 'm',
      LLM_EVIL_PRICE_IN: '0',
      LLM_EVIL_PRICE_OUT: '0',
      LLM_ODD_API_KEY: 'k', // no base URL, no preset
    });
    expect(Object.keys(c.providers)).toEqual(['mock']);
    expect(c.tasks.router).toBeNull();
    expect(c.warnings.join('\n')).toMatch(/openai ignored: set LLM_OPENAI_PRICE_IN/);
    expect(c.warnings.join('\n')).toMatch(/evil ignored: base URL must be https/);
    expect(c.warnings.join('\n')).toMatch(/odd ignored: set LLM_ODD_BASE_URL/);
    expect(c.warnings.join('\n')).toMatch(/LLM_ROUTER=openai: no such provider/);
  });
});

describe('chat over HTTP (OpenAI-compatible)', () => {
  let server: Server;
  let seen: { auth?: string; body: Record<string, unknown> }[] = [];
  let reply: (res: import('node:http').ServerResponse) => void;
  let p: Provider;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, body: JSON.parse(b) });
        reply(res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    p = { name: 'fake', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'sk-secret', model: 'fake-1', priceIn: 1, priceOut: 2 };
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('posts model, messages and tools; returns tool calls and usage', async () => {
    seen = [];
    reply = (res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_devices', arguments: '{}' } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    };
    const tools = toolSpecs(simRegistry());
    const r = await chat(p, { messages: [{ role: 'user', content: 'hi' }], tools });
    expect(seen[0]!.auth).toBe('Bearer sk-secret');
    expect(seen[0]!.body).toMatchObject({ model: 'fake-1', messages: [{ role: 'user', content: 'hi' }], tool_choice: 'auto', temperature: 0, max_tokens: 512 });
    expect((seen[0]!.body.tools as unknown[]).length).toBe(tools.length);
    expect(r.message.tool_calls![0]!.function.name).toBe('list_devices');
    expect(r.usage).toEqual({ in: 100, out: 20 });
    expect(costUsd(p, r.usage)).toBeCloseTo((100 * 1 + 20 * 2) / 1e6, 12);
  });

  it('speaks the Responses API when asked: same messages and tools in, tool calls and usage out', async () => {
    seen = [];
    reply = (res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'reasoning' }, { type: 'function_call', call_id: 'c9', name: 'set_device', arguments: '{"device":"livingroom/light","on":true}' }], usage: { input_tokens: 69, output_tokens: 24 } }));
    };
    const rp = { ...p, api: 'responses' as const, maxOut: 100 };
    const r = await chat(rp, {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'bật đèn' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_devices', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      ],
      tools: toolSpecs(simRegistry()),
    });
    expect(seen[0]!.body).toMatchObject({
      model: 'fake-1',
      instructions: 'sys',
      max_output_tokens: 100,
      store: false,
      input: [
        { role: 'user', content: 'bật đèn' },
        { type: 'function_call', call_id: 'c1', name: 'list_devices', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
      ],
    });
    expect((seen[0]!.body.tools as { type: string; name: string }[])[0]).toMatchObject({ type: 'function', name: 'list_devices' });
    expect(r.message.tool_calls).toEqual([{ id: 'c9', type: 'function', function: { name: 'set_device', arguments: '{"device":"livingroom/light","on":true}' } }]);
    expect(r.usage).toEqual({ in: 69, out: 24 });
    reply = (res) => res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Xin chào' }] }] }));
    expect((await chat(rp, { messages: [{ role: 'user', content: 'hi' }] })).message.content).toBe('Xin chào');
  });

  it('HTTP errors are errors, unreachable is offline, and the key never shows up in messages', async () => {
    reply = (res) => {
      res.statusCode = 429;
      res.end('rate limited');
    };
    await expect(chat(p, { messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ kind: 'error' });
    const dead = { ...p, baseUrl: 'http://127.0.0.1:1/v1' };
    const e = await chat(dead, { messages: [{ role: 'user', content: 'x' }] }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LlmUnavailable);
    expect((e as LlmUnavailable).kind).toBe('offline');
    expect((e as Error).message).not.toContain('sk-secret');
    reply = () => {}; // never answers
    await expect(chat(p, { messages: [{ role: 'user', content: 'x' }] }, { timeoutMs: 200 })).rejects.toMatchObject({ kind: 'offline', message: /timeout/ });
  });
});

describe('mock provider', () => {
  const reg = simRegistry();
  const tools = toolSpecs(reg);
  const calls = (text: string) => mockChat({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: text }], tools }).message.tool_calls?.map((c) => [c.function.name, JSON.parse(c.function.arguments)]);

  it('picks tools from words the local router does not know', () => {
    expect(calls('trong phòng có oi bức nóng nực lắm không')).toEqual([['get_sensor', { metric: 'temp' }]]);
    expect(calls('không khí ngoài ban công có trong lành không')).toEqual([['get_sensor', { metric: 'co2', room: 'balcony' }]]);
    expect(calls('sắp đi ngủ rồi')).toEqual([['run_scene', { name: 'sleep' }]]);
    expect(calls('kể chuyện cười')).toBeUndefined();
  });

  it('answers from tool results, is deterministic and counts tokens', () => {
    const req = {
      messages: [
        { role: 'user' as const, content: 'q' },
        { role: 'assistant' as const, content: null, tool_calls: [{ id: 'a', type: 'function' as const, function: { name: 'get_sensor', arguments: '{}' } }] },
        { role: 'tool' as const, tool_call_id: 'a', content: JSON.stringify({ ok: true, text: 'Bedroom 27.4°C' }) },
      ],
    };
    const r = mockChat(req);
    expect(r.message.content).toBe('Bedroom 27.4°C');
    expect(mockChat(req)).toEqual(r);
    expect(r.usage.in).toBeGreaterThan(0);
    expect(costUsd(MOCK, r.usage)).toBeGreaterThan(0);
  });
});

describe('tools', () => {
  const reg = simRegistry();
  it('are generated from the registry', () => {
    const specs = toolSpecs(reg);
    expect(specs.map((s) => s.function.name)).toEqual(['list_devices', 'get_sensor', 'set_device', 'run_scene']);
    const set = specs.find((s) => s.function.name === 'set_device')!.function.parameters as { properties: { device: { enum: string[] } } };
    expect(set.properties.device.enum).toEqual(['kitchen/plug', 'livingroom/light']);
    expect(toolSpecs(reg, { physical: false }).map((s) => s.function.name)).toEqual(['list_devices', 'get_sensor']);
  });
  it('validate what the LLM sends', () => {
    expect(parseToolCall('set_device', '{"device":"livingroom/light","on":true}', reg)).toEqual({ ok: true, call: { name: 'set_device', args: { device: 'livingroom/light', on: true } } });
    expect(parseToolCall('set_device', '{"device":"garage/door","on":true}', reg)).toMatchObject({ ok: false });
    expect(parseToolCall('set_device', '{"device":"livingroom/light","on":"yes"}', reg)).toMatchObject({ ok: false });
    expect(parseToolCall('get_sensor', '{"metric":"pressure"}', reg)).toMatchObject({ ok: false });
    expect(parseToolCall('get_sensor', 'not json', reg)).toMatchObject({ ok: false });
    expect(parseToolCall('rm_rf', '{}', reg)).toMatchObject({ ok: false });
    expect(chipLabel({ name: 'get_sensor', args: { metric: 'temp', room: 'bedroom' } })).toBe('get_sensor temp bedroom');
  });
});
