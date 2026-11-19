/** Brain settings, read once from the environment (`.env` in dev, `infra/pi/brain.env` + compose on the Pi). */
import { dirname, join } from 'node:path';

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

export const TASKS = ['router', 'chat', 'research'] as const;
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
  /** Provider per kind of work. `router` picks the tools; `chat` writes the answer after tools ran; `research` plans and writes research (M6). null = no LLM. */
  tasks: Record<Task, string | null>;
  /** GitHub Actions watching (M3). null = off (no token or no repos). */
  github: GithubConfig | null;
  /** Publish this machine's stats on vega/system/pi (the brain on the Pi). */
  piStats: boolean;
  /** Google Calendar + Gmail, read only (M4). null = off (no OAuth client). */
  google: GoogleConfig | null;
  /** Open-Meteo forecast for the briefing (M4). null = no coordinates. */
  weather: { lat: number; lon: number; apiUrl: string } | null;
  /** Web search (M6, Tavily). null = no key: research is off. */
  search: { apiKey: string; apiUrl: string; maxMonth: number } | null;
  /** Limits of one research: USD for all its LLM calls, output tokens of the answer. */
  research: { maxUsd: number; maxOut: number };
  /** Local time of the daily briefing, `HH:MM`. */
  briefingAt: string;
  /** Language of what VEGA says on its own (the briefing, reminders): `vi` or `en`. */
  lang: 'vi' | 'en';
  /** Settings that were ignored, with the reason (logged at start). */
  warnings: string[];
}

export interface GithubConfig {
  /** Fine-grained, read-only token (Actions + Metadata). Never logged. */
  token: string;
  /** `owner/repo` */
  repos: string[];
  apiUrl: string;
  intervalMs: number;
}

export interface GoogleConfig {
  /** OAuth client of type "Desktop app" (the owner's own Google Cloud project). The secret is never logged. */
  clientId: string;
  clientSecret: string;
  /** Refresh token written by `npm run google-login` (mode 600). */
  tokenFile: string;
  /** Or the refresh token itself (GOOGLE_REFRESH_TOKEN, in brain.env on the Pi): used instead of the file. */
  refreshToken?: string;
  calendars: string[];
  apiUrl: string;
  tokenUrl: string;
  authUrl: string;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const SAFE_URL = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;

function github(env: Env, warnings: string[]): GithubConfig | null {
  const token = env.GITHUB_TOKEN?.trim();
  const list = (env.GITHUB_REPOS ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  if (!token && !list.length) return null;
  const repos = list.filter((r) => REPO.test(r));
  for (const r of list.filter((r) => !REPO.test(r))) warnings.push(`GITHUB_REPOS: "${r}" ignored, expected owner/repo`);
  const apiUrl = (env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, '');
  if (!token) return warnings.push('GITHUB_REPOS set but GITHUB_TOKEN missing: CI watching is off'), null;
  if (!repos.length) return warnings.push('GITHUB_TOKEN set but GITHUB_REPOS has no owner/repo: CI watching is off'), null;
  if (!SAFE_URL.test(apiUrl)) return warnings.push('GITHUB_API_URL must be https (or http on localhost): CI watching is off'), null;
  return { token, repos, apiUrl, intervalMs: num(env.GITHUB_POLL_S, 60, 30) * 1000 };
}

function google(env: Env, dbPath: string, warnings: string[]): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) return warnings.push('set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET: Google is off'), null;
  const url = (k: string, def: string) => (env[k]?.trim() || def).replace(/\/+$/, '');
  const apiUrl = url('GOOGLE_API_URL', 'https://www.googleapis.com');
  const tokenUrl = url('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token');
  const authUrl = url('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth');
  if (![apiUrl, tokenUrl, authUrl].every((u) => SAFE_URL.test(u))) return warnings.push('Google URLs must be https (or http on localhost): Google is off'), null;
  const calendars = (env.GOOGLE_CALENDARS ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const dir = dbPath === ':memory:' ? '.' : dirname(dbPath);
  const refreshToken = env.GOOGLE_REFRESH_TOKEN?.trim();
  return { clientId, clientSecret, tokenFile: env.GOOGLE_TOKEN_FILE?.trim() || join(dir, 'google-token.json'), ...(refreshToken && { refreshToken }), calendars: calendars.length ? calendars : ['primary'], apiUrl, tokenUrl, authUrl };
}

function weather(env: Env, warnings: string[]): Config['weather'] {
  if (!env.WEATHER_LAT && !env.WEATHER_LON) return null;
  const lat = Number(env.WEATHER_LAT);
  const lon = Number(env.WEATHER_LON);
  const apiUrl = (env.WEATHER_API_URL?.trim() || 'https://api.open-meteo.com').replace(/\/+$/, '');
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || !env.WEATHER_LAT || !env.WEATHER_LON) return warnings.push('WEATHER_LAT / WEATHER_LON must be numbers: weather is off'), null;
  if (!SAFE_URL.test(apiUrl)) return warnings.push('WEATHER_API_URL must be https (or http on localhost): weather is off'), null;
  return { lat, lon, apiUrl };
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
  const chatTask = env.LLM_CHAT ? pick(env.LLM_CHAT, 'chat') : router;
  const searchKey = env.TAVILY_API_KEY?.trim();
  const searchUrl = (env.TAVILY_API_URL?.trim() || 'https://api.tavily.com').replace(/\/+$/, '');
  if (searchKey && !SAFE_URL.test(searchUrl)) warnings.push('TAVILY_API_URL must be https (or http on localhost): research is off');
  const dbPath = env.BRAIN_DB || 'brain.db';
  const briefingAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(env.BRIEFING_AT ?? '') ? env.BRIEFING_AT! : '07:00';
  if (env.BRIEFING_AT && briefingAt !== env.BRIEFING_AT) warnings.push(`BRIEFING_AT=${env.BRIEFING_AT}: expected HH:MM, using 07:00`);
  return {
    mqttUrl: env.MQTT_URL || 'mqtt://localhost:1883',
    ...(env.MQTT_USER && { mqttUser: env.MQTT_USER }),
    ...(env.MQTT_PASS && { mqttPass: env.MQTT_PASS }),
    defaultRoom: env.VEGA_ROOM || 'bedroom',
    dbPath,
    budgetUsdDay: num(env.BUDGET_USD_DAY, 0.2),
    ratePerMin: num(env.RATE_LIMIT_PER_MIN, 10, 1),
    confirmTtlS: num(env.CONFIRM_TTL_S, 30, 5),
    llmTimeoutMs: num(env.LLM_TIMEOUT_MS, 20_000, 1000),
    providers: provs,
    tasks: { router, chat: chatTask, research: env.LLM_RESEARCH ? pick(env.LLM_RESEARCH, 'research') : chatTask },
    search: searchKey && SAFE_URL.test(searchUrl) ? { apiKey: searchKey, apiUrl: searchUrl, maxMonth: num(env.SEARCH_MAX_MONTH, 900, 1) } : null,
    research: { maxUsd: num(env.RESEARCH_MAX_USD, 0.01), maxOut: num(env.RESEARCH_MAX_OUTPUT_TOKENS, 800, 100) },
    github: github(env, warnings),
    piStats: env.PI_STATS === '1',
    google: google(env, dbPath, warnings),
    weather: weather(env, warnings),
    briefingAt,
    lang: env.VEGA_LANG?.trim().toLowerCase() === 'en' ? 'en' : 'vi',
    warnings,
  };
}
