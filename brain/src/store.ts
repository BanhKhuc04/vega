import { DatabaseSync } from 'node:sqlite';

/** Local calendar day, `YYYY-MM-DD` (the daily budget resets at local midnight; set TZ in the container). */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface CommandRow {
  id: string;
  ts: number;
  text: string;
  origin: string;
  path: string;
  answer: string;
  tools: string[];
  llmCalls: number;
}
export interface UsageRow {
  ts: number;
  commandId: string;
  task: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

/** Command log and LLM cost ledger in SQLite (`node:sqlite`, built into Node: no extra dependency). */
export class Store {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL, text TEXT NOT NULL, origin TEXT NOT NULL,
        path TEXT NOT NULL, answer TEXT NOT NULL, tools TEXT NOT NULL, llm_calls INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS llm_usage (
        ts INTEGER NOT NULL, day TEXT NOT NULL, command_id TEXT NOT NULL, task TEXT NOT NULL, provider TEXT NOT NULL,
        model TEXT NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, usd REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS llm_usage_day ON llm_usage (day);
      CREATE INDEX IF NOT EXISTS llm_usage_cmd ON llm_usage (command_id);
    `);
  }

  logCommand(r: CommandRow): void {
    this.db
      .prepare('INSERT INTO commands (id, ts, day, text, origin, path, answer, tools, llm_calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.ts, dayOf(r.ts), r.text, r.origin, r.path, r.answer, JSON.stringify(r.tools), r.llmCalls);
  }

  logUsage(r: UsageRow): void {
    this.db
      .prepare('INSERT INTO llm_usage (ts, day, command_id, task, provider, model, tokens_in, tokens_out, usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.ts, dayOf(r.ts), r.commandId, r.task, r.provider, r.model, r.tokensIn, r.tokensOut, r.usd);
  }

  /** USD spent on LLM calls on a local day. */
  spentUsd(day: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM llm_usage WHERE day = ?').get(day) as { usd: number };
    return row.usd;
  }

  /** LLM calls recorded for one command (the ledger is the proof that local commands cost nothing). */
  llmCallsFor(commandId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM llm_usage WHERE command_id = ?').get(commandId) as { n: number }).n;
  }

  lastCommands(limit = 20): CommandRow[] {
    const rows = this.db.prepare('SELECT id, ts, text, origin, path, answer, tools, llm_calls FROM commands ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit) as (Omit<CommandRow, 'tools' | 'llmCalls'> & { tools: string; llm_calls: number })[];
    return rows.map(({ tools, llm_calls, ...r }) => ({ ...r, tools: JSON.parse(tools) as string[], llmCalls: llm_calls }));
  }

  close(): void {
    this.db.close();
  }
}
