import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { ChatRequest } from '../src/llm';
import { mockChat } from '../src/mock';

/**
 * A stand-in for Ollama's OpenAI-compatible API on the owner's PC (M15): `GET /v1/models` and `POST /v1/chat/completions`,
 * answered by the mock model. `failChat` makes chat answer HTTP 500 (the model broke); `close()` is the PC switched off.
 */
export async function fakeOllama() {
  const hits = { models: 0, chat: 0 };
  const state = { failChat: false };
  const server: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/v1/models') {
        hits.models++;
        return void res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen3:4b-instruct-2507-q4_K_M', object: 'model' }] }));
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        hits.chat++;
        if (state.failChat) return void ((res.statusCode = 500), res.end('{"error":{"message":"model runner has unexpectedly stopped"}}'));
        const r = mockChat(JSON.parse(b) as ChatRequest);
        return void res.end(JSON.stringify({ choices: [{ message: r.message }], usage: { prompt_tokens: r.usage.in, completion_tokens: r.usage.out } }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  return {
    hits,
    state,
    env: { LLM_LOCAL: 'ollama', LLM_OLLAMA_BASE_URL: url, LLM_OLLAMA_MODEL: 'qwen3:4b-instruct-2507-q4_K_M', LLM_OLLAMA_PRICE_IN: '0', LLM_OLLAMA_PRICE_OUT: '0' },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
