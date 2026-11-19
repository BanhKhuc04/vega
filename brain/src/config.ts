/** Brain settings, read once from the environment (`.env` in dev, `infra/pi/brain.env` + compose on the Pi). */

export interface Provider {
  name: string;
  /** OpenAI-compatible endpoint root, e.g. `https://api.openai.com/v1`; `mock://` for the built-in mock. */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** USD per million input / output tokens. */
  priceIn: number;
  priceOut: number;
  /** Which OpenAI API the endpoint speaks: Chat Completions (default) or Responses (some gateways block the former). */
  api?: 'chat' | 'responses';
  /** Cap on output tokens per call (reasoning included), so one call can never cost much. */
  maxOut?: number;
}

export const TASKS = ['router', 'chat'] as const;
export type Task = (typeof TASKS)[number];

export interface Config {
  mqttUrl: string;
  mqttUser?: string;
  mqttPass?: string;
  /** Room a sensor question means when it names none. */
  defaultRoom: string;
  dbPath: string;
  budgetUsdDay: number;
  ratePerMin: number;
  confirmTtlS: number;
  llmTimeoutMs: number;
  providers: Record<string, Provider>;
  /** Provider per kind of work. `router` picks the tools; `chat` writes the answer after tools ran. null = no LLM. */
  tasks: Record<Task, string | null>;
  /** Settings that were ignored, with the reason (logged at start). */
  warnings: string[];
}

/** Base URLs of common OpenAI-compatible providers, so `.env` only needs the key, the model and the prices. */
export const PRESETS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  mistral: 'https://api.mistral.ai/v1',
};

/** Fixed, offline provider for tests, CI and the bench. Its prices are made up so cost accounting is exercised. */
export const MOCK: Provider = { name: 'mock', baseUrl: 'mock://', model: 'mock-1', priceIn: 0.5, priceOut: 1.5 };

type Env = Record<string, string | undefined>;

const num = (v: string | undefined, def: number, min = 0): number => {
  const n = v === undefined || v === '' ? def : Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};

function providers(env: Env, warnings: string[]): Record<string, Provider> {
  const out: Record<string, Provider> = { mock: { ...MOCK, priceIn: num(env.LLM_MOCK_PRICE_IN, MOCK.priceIn), priceOut: num(env.LLM_MOCK_PRICE_OUT, MOCK.priceOut) } };
  const names = new Set<string>();
  for (const k of Object.keys(env)) {
    const m = /^LLM_([A-Z0-9]+)_(API_KEY|BASE_URL|MODEL)$/.exec(k);
    if (m && m[1] !== 'MOCK') names.add(m[1]!);
  }
  for (const N of names) {
    const name = N.toLowerCase();
    const get = (f: string) => env[`LLM_${N}_${f}`]?.trim() || undefined;
    const baseUrl = get('BASE_URL') ?? PRESETS[name];
    const model = get('MODEL');
    const priceIn = Number(get('PRICE_IN'));
    const priceOut = Number(get('PRICE_OUT'));
    const apiKey = get('API_KEY');
    const api = get('API') ?? 'chat';
    const maxOut = num(get('MAX_OUTPUT_TOKENS'), 512, 16);
    const skip = (why: string) => warnings.push(`provider ${name} ignored: ${why}`);
    if (!baseUrl) skip(`set LLM_${N}_BASE_URL`);
    else if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(baseUrl)) skip('base URL must be https (or http on localhost)');
    else if (!model) skip(`set LLM_${N}_MODEL`);
    else if (api !== 'chat' && api !== 'responses') skip(`LLM_${N}_API must be chat or responses`);
    // without prices the daily budget could not be enforced
    else if (!(priceIn >= 0) || !(priceOut >= 0) || get('PRICE_IN') === undefined || get('PRICE_OUT') === undefined) skip(`set LLM_${N}_PRICE_IN and LLM_${N}_PRICE_OUT (USD per 1M tokens)`);
    else out[name] = { name, baseUrl: baseUrl.replace(/\/+$/, ''), model, priceIn, priceOut, api, maxOut, ...(apiKey && { apiKey }) };
  }
  return out;
}

export function loadConfig(env: Env = process.env): Config {
  const warnings: string[] = [];
  const provs = providers(env, warnings);
  const pick = (v: string | undefined, task: string): string | null => {
    const name = v?.trim().toLowerCase();
    if (!name || name === 'none') return null;
    if (provs[name]) return name;
    warnings.push(`LLM_${task.toUpperCase()}=${name}: no such provider, ${task} uses no LLM`);
    return null;
  };
  const router = pick(env.LLM_ROUTER, 'router');
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    ...(env.MQTT_USER && { mqttUser: env.MQTT_USER }),
    ...(env.MQTT_PASS && { mqttPass: env.MQTT_PASS }),
    defaultRoom: env.VEGA_ROOM || 'bedroom',
    dbPath: env.BRAIN_DB || 'brain.db',
    budgetUsdDay: num(env.BUDGET_USD_DAY, 0.2),
    ratePerMin: num(env.RATE_LIMIT_PER_MIN, 10, 1),
    confirmTtlS: num(env.CONFIRM_TTL_S, 30, 5),
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 20_000, 1000),
    providers: provs,
    tasks: { router, chat: env.LLM_CHAT ? pick(env.LLM_CHAT, 'chat') : router },
    warnings,
  };
}
