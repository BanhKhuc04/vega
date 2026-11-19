import type { Provider } from './config';
import { mockChat } from './mock';

/** OpenAI-compatible chat completion types (the subset VEGA uses). */
export interface ToolCallMsg {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCallMsg[] }
  | { role: 'tool'; content: string; tool_call_id: string };
export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
}
export interface Usage {
  in: number;
  out: number;
}
export interface ChatResponse {
  message: Extract<ChatMessage, { role: 'assistant' }>;
  usage: Usage;
}

/** `offline`: the provider could not be reached (no internet, DNS, timeout). `error`: it answered with an error. */
export class LlmUnavailable extends Error {
  constructor(
    readonly kind: 'offline' | 'error',
    message: string,
  ) {
    super(message);
  }
}

export const costUsd = (p: Provider, u: Usage): number => (u.in * p.priceIn + u.out * p.priceOut) / 1e6;

export interface ChatOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Request body for the OpenAI Responses API (`/responses`), built from the same chat messages and tools. */
function responsesBody(p: Provider, req: ChatRequest): Record<string, unknown> {
  const input = req.messages.flatMap((m): unknown[] => {
    if (m.role === 'system') return [];
    if (m.role === 'tool') return [{ type: 'function_call_output', call_id: m.tool_call_id, output: m.content }];
    if (m.role === 'assistant')
      return [...(m.content ? [{ role: 'assistant', content: m.content }] : []), ...(m.tool_calls ?? []).map((t) => ({ type: 'function_call', call_id: t.id, name: t.function.name, arguments: t.function.arguments }))];
    return [{ role: 'user', content: m.content }];
  });
  const instructions = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  return {
    model: p.model,
    input,
    store: false,
    max_output_tokens: p.maxOut ?? 512,
    ...(instructions && { instructions }),
    ...(req.tools?.length && { tools: req.tools.map((t) => ({ type: 'function', ...t.function })), tool_choice: 'auto' }),
  };
}

type ResponsesOut = {
  output?: ({ type: 'function_call'; call_id: string; name: string; arguments: string } | { type: 'message'; content?: { type: string; text?: string }[] } | { type: string })[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** One chat turn. Plain `fetch`, no SDK, Chat Completions or Responses API. Never logs or returns the API key. */
export async function chat(p: Provider, req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
  if (p.baseUrl === 'mock://') return mockChat(req);
  const f = opts.fetchImpl ?? fetch;
  const responses = p.api === 'responses';
  let res: Response;
  try {
    res = await f(`${p.baseUrl}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(p.apiKey && { authorization: `Bearer ${p.apiKey}` }) },
      body: JSON.stringify(
        responses
          ? responsesBody(p, req)
          : { model: p.model, messages: req.messages, temperature: 0, max_tokens: p.maxOut ?? 512, ...(req.tools?.length && { tools: req.tools, tool_choice: 'auto' }) },
      ),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new LlmUnavailable('offline', `${p.name}: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    throw new LlmUnavailable('error', `${p.name}: HTTP ${res.status} ${body}`);
  }
  if (responses) {
    const r = (await res.json().catch(() => null)) as ResponsesOut | null;
    if (!r?.output) throw new LlmUnavailable('error', `${p.name}: response without output`);
    const calls: ToolCallMsg[] = [];
    let text = '';
    for (const o of r.output) {
      if (o.type === 'function_call' && 'call_id' in o) calls.push({ id: o.call_id, type: 'function', function: { name: o.name, arguments: o.arguments } });
      else if (o.type === 'message' && 'content' in o) text += (o.content ?? []).map((c) => c.text ?? '').join('');
    }
    return {
      message: { role: 'assistant', content: text || null, ...(calls.length && { tool_calls: calls }) },
      usage: { in: r.usage?.input_tokens ?? 0, out: r.usage?.output_tokens ?? 0 },
    };
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCallMsg[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  const m = data?.choices?.[0]?.message;
  if (!m) throw new LlmUnavailable('error', `${p.name}: response without choices[0].message`);
  return {
    message: { role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length && { tool_calls: m.tool_calls }) },
    usage: { in: data?.usage?.prompt_tokens ?? 0, out: data?.usage?.completion_tokens ?? 0 },
  };
}
