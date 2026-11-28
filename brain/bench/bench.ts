/**
 * `npm run bench [-- --provider mock] [--cases file] [--verbose]`: runs the sample Vietnamese commands straight
 * through each LLM provider (the local router is bypassed, that is the point) and prints accuracy, p50 latency
 * and USD per 100 commands. Without --provider it runs every provider that has an API key in the environment.
 * `npm run bench -- --local` instead runs the no-AI tiers (exact router, then the meaning tier of M11) on the same cases.
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
import type { ToolCall } from '../src/tools';
import { routeLocal } from '../src/local';
import { routeIntent } from '../src/intent';
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
    } catch (e) {
      row.errors++;
      row.misses.push({ text: c.text, got: [{ tool: 'ERROR', args: { message: (e as Error).message } }] }); // never contains the key (llm.ts)
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

export interface LocalRow {
  tier: string;
  /** Commands (cases that expect a tool) done right with no AI. */
  correct: number;
  commands: number;
  /** Tools called that the case did not expect: must stay 0. */
  wrong: number;
  /** Left to the LLM. */
  toLlm: number;
  maxMs: number;
  misses: { text: string; got: Expected[] | null }[];
}

/** The no-AI tiers over the same cases (M11): the exact router alone, then with the meaning tier behind it. */
export function benchLocal(cases: Case[]): LocalRow[] {
  const reg = simRegistry();
  const opts = { defaultRoom: DEFAULT_ROOM };
  const tiers: [string, (t: string) => ToolCall[] | null][] = [
    ['exact (local.ts)', (t) => routeLocal(t, reg, opts)],
    ['exact + meaning (intent.ts)', (t) => routeLocal(t, reg, opts) ?? routeIntent(t, reg, opts)],
  ];
  return tiers.map(([tier, route]) => {
    const row: LocalRow = { tier, correct: 0, commands: cases.filter((c) => c.expect.length).length, wrong: 0, toLlm: 0, maxMs: 0, misses: [] };
    for (const c of cases) {
      const t0 = performance.now();
      const calls = route(c.text);
      row.maxMs = Math.max(row.maxMs, performance.now() - t0);
      const got = calls?.map((x): Expected => ({ tool: x.name, args: x.args as Record<string, unknown> })) ?? null;
      if (!got) row.toLlm++;
      else if (matches(c.expect, got)) row.correct++;
      else row.wrong++;
      if (c.expect.length && !(got && matches(c.expect, got))) row.misses.push({ text: c.text, got });
    }
    return row;
  });
}

export function localTable(rows: LocalRow[]): string {
  return [
    '| tier | right with no AI | wrong tool | to the LLM | slowest |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.tier} | ${r.correct}/${r.commands} (${Math.round((100 * r.correct) / r.commands)}%) | ${r.wrong} | ${r.toLlm} | ${r.maxMs.toFixed(1)} ms |`),
  ].join('\n');
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
  if (argv.includes('--local')) {
    const rows = benchLocal(loadCases(arg('--cases') ?? fileURLToPath(new URL('./cases.jsonl', import.meta.url))));
    console.log(localTable(rows));
    if (argv.includes('--verbose')) for (const r of rows) for (const m of r.misses) console.log(`miss [${r.tier}] "${m.text}" -> ${JSON.stringify(m.got)}`);
    return 0;
  }
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
