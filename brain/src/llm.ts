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

/** One chat completion. Plain `fetch`, no SDK. Never logs or returns the API key. */
export async function chat(p: Provider, req: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
  if (p.baseUrl === 'mock://') return mockChat(req);
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(p.apiKey && { authorization: `Bearer ${p.apiKey}` }) },
      body: JSON.stringify({ model: p.model, messages: req.messages, temperature: 0, ...(req.tools?.length && { tools: req.tools, tool_choice: 'auto' }) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new LlmUnavailable('offline', `${p.name}: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    throw new LlmUnavailable('error', `${p.name}: HTTP ${res.status} ${body}`);
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
