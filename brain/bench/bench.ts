/**
 * `npm run bench [-- --provider mock] [--cases file] [--verbose]`: runs the sample Vietnamese commands straight
 * through each LLM provider (the local router is bypassed, that is the point) and prints accuracy, p50 latency
 * and USD per 100 commands. Without --provider it runs every provider that has an API key in the environment.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT } from '../src/agent';
import { loadConfig } from '../src/config';
import type { Provider } from '../src/config';
import { chat, costUsd } from '../src/llm';
import type { ChatMessage, ChatResponse } from '../src/llm';
import { toolSpecs } from '../src/tools';
import { simRegistry } from './registry';

export interface Expected {
  tool: string;
  args: Record<string, unknown>;
}
export interface Case {
  text: string;
  expect: Expected[];
}
export interface Row {
  provider: string;
  model: string;
  correct: number;
  total: number;
  errors: number;
  p50Ms: number;
  usdPer100: number;
  misses: { text: string; got: Expected[] }[];
}

const DEFAULT_ROOM = 'bedroom';

/** Order-insensitive match on tool names and arguments. A sensor read without a room means the default room. */
export function matches(expected: Expected[], got: Expected[]): boolean {
  const key = (c: Expected) => {
    const a = { ...c.args };
    if (c.tool === 'get_sensor' && (a.room === undefined || a.room === DEFAULT_ROOM)) delete a.room;
    return `${c.tool}:${JSON.stringify(Object.fromEntries(Object.entries(a).sort(([x], [y]) => x.localeCompare(y))))}`;
  };
  const e = expected.map(key).sort();
  const g = [...new Set(got.map(key))].sort();
  return e.length === g.length && e.every((k, i) => k === g[i]);
}

export function loadCases(path: string): Case[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** One provider over all cases: the tool-picking call decides correctness; the answer call is added to the cost. */
export async function benchProvider(p: Provider, cases: Case[], opts: { timeoutMs?: number } = {}): Promise<Row> {
  const reg = simRegistry();
  const tools = toolSpecs(reg);
  const row: Row = { provider: p.name, model: p.model, correct: 0, total: cases.length, errors: 0, p50Ms: 0, usdPer100: 0, misses: [] };
  const latencies: number[] = [];
  let usd = 0;
  for (const c of cases) {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: c.text },
    ];
    let res: ChatResponse;
    const t0 = performance.now();
    try {
      res = await chat(p, { messages, tools }, { timeoutMs: opts.timeoutMs ?? 30_000 });
    } catch {
      row.errors++;
      row.misses.push({ text: c.text, got: [{ tool: 'ERROR', args: {} }] });
      continue;
    }
    latencies.push(performance.now() - t0);
    usd += costUsd(p, res.usage);
    const got = (res.message.tool_calls ?? []).map((tc): Expected => {
      try {
        return { tool: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown> };
      } catch {
        return { tool: tc.function.name, args: { invalid: tc.function.arguments } };
      }
    });
    if (matches(c.expect, got)) row.correct++;
    else row.misses.push({ text: c.text, got });
    if (res.message.tool_calls?.length) {
      // second turn, as the brain does it: tool results in, short answer out (cost only)
      const follow: ChatMessage[] = [...messages, res.message, ...res.message.tool_calls.map((tc): ChatMessage => ({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ ok: true, text: 'done' }) }))];
      try {
        usd += costUsd(p, (await chat(p, { messages: follow, tools }, { timeoutMs: opts.timeoutMs ?? 30_000 })).usage);
      } catch {
        row.errors++;
      }
    }
  }
  row.p50Ms = Math.round(median(latencies));
  row.usdPer100 = (usd / cases.length) * 100;
  return row;
}

export function table(rows: Row[]): string {
  const lines = [
    '| provider | model | accuracy | p50 latency | USD / 100 commands | errors |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.provider} | ${r.model} | ${r.correct}/${r.total} (${Math.round((100 * r.correct) / r.total)}%) | ${r.p50Ms} ms | $${r.usdPer100.toFixed(4)} | ${r.errors} |`),
  ];
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  try {
    process.loadEnvFile();
  } catch {
    // no .env
  }
  const cfg = loadConfig();
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const wanted = argv.flatMap((a, i) => (argv[i - 1] === '--provider' ? a.split(',') : [])).map((s) => s.trim().toLowerCase());
  const names = wanted.length ? wanted : Object.values(cfg.providers).filter((p) => p.apiKey).map((p) => p.name);
  for (const w of cfg.warnings) console.error(`config: ${w}`);
  if (names.length === 0) {
    console.error('No provider with an API key in .env. Add LLM_<NAME>_API_KEY, _MODEL, _PRICE_IN, _PRICE_OUT, or run: npm run bench -- --provider mock');
    return 2;
  }
  const unknown = names.filter((n) => !cfg.providers[n]);
  if (unknown.length) {
    console.error(`Unknown provider(s): ${unknown.join(', ')}. Known: ${Object.keys(cfg.providers).join(', ')}`);
    return 2;
  }
  const cases = loadCases(arg('--cases') ?? fileURLToPath(new URL('./cases.jsonl', import.meta.url)));
  const rows: Row[] = [];
  for (const n of names) {
    console.error(`running ${cases.length} commands on ${n}…`);
    rows.push(await benchProvider(cfg.providers[n]!, cases, { timeoutMs: cfg.llmTimeoutMs }));
  }
  console.log(table(rows));
  if (argv.includes('--verbose')) for (const r of rows) for (const m of r.misses) console.log(`miss [${r.provider}] "${m.text}" -> ${JSON.stringify(m.got)}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
