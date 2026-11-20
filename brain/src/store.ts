import { DatabaseSync } from 'node:sqlite';
import { localDay } from '@vega/contract';

/** Local calendar day, `YYYY-MM-DD` (the daily budget resets at local midnight; set TZ in the container). */
export const dayOf = localDay;

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
export interface Reminder {
  id: number;
  at: number;
  text: string;
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
      CREATE TABLE IF NOT EXISTS searches (
        ts INTEGER NOT NULL, month TEXT NOT NULL, command_id TEXT NOT NULL, provider TEXT NOT NULL, query TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS searches_month ON searches (month);
      CREATE TABLE IF NOT EXISTS stt_usage (
        ts INTEGER NOT NULL, day TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, seconds REAL NOT NULL, usd REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS stt_usage_day ON stt_usage (day);
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      );
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

  /** One transcription (M5): counted against the daily minutes and, with the LLM calls, the daily budget. */
  logStt(ts: number, provider: string, model: string, seconds: number, usd: number): void {
    this.db.prepare('INSERT INTO stt_usage (ts, day, provider, model, seconds, usd) VALUES (?, ?, ?, ?, ?, ?)').run(ts, dayOf(ts), provider, model, seconds, usd);
  }

  /** Seconds of audio transcribed on a local day. */
  sttSecondsOn(day: string): number {
    return (this.db.prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM stt_usage WHERE day = ?').get(day) as { s: number }).s;
  }

  private sttUsd(day: string): number {
    return (this.db.prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM stt_usage WHERE day = ?').get(day) as { usd: number }).usd;
  }

  /** USD spent on AI on a local day: LLM calls and speech to text. */
  spentUsd(day: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM llm_usage WHERE day = ?').get(day) as { usd: number };
    return row.usd + this.sttUsd(day);
  }

  /** Totals of one local day: what the screen shows as "AI budget" (usd includes speech to text; calls and tokens are LLM only). */
  usageOn(day: string): { usd: number; calls: number; tokensIn: number; tokensOut: number } {
    const u = this.db
      .prepare('SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS calls, COALESCE(SUM(tokens_in), 0) AS tokensIn, COALESCE(SUM(tokens_out), 0) AS tokensOut FROM llm_usage WHERE day = ?')
      .get(day) as { usd: number; calls: number; tokensIn: number; tokensOut: number };
    return { ...u, usd: u.usd + this.sttUsd(day) };
  }

  /** LLM calls recorded for one command (the ledger is the proof that local commands cost nothing). */
  llmCallsFor(commandId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM llm_usage WHERE command_id = ?').get(commandId) as { n: number }).n;
  }

  lastCommands(limit = 20): CommandRow[] {
    const rows = this.db.prepare('SELECT id, ts, text, origin, path, answer, tools, llm_calls FROM commands ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit) as (Omit<CommandRow, 'tools' | 'llmCalls'> & { tools: string; llm_calls: number })[];
    return rows.map(({ tools, llm_calls, ...r }) => ({ ...r, tools: JSON.parse(tools) as string[], llmCalls: llm_calls }));
  }

  /** One web search, counted against the monthly allowance of the search provider. */
  logSearch(ts: number, commandId: string, provider: string, query: string): void {
    this.db.prepare('INSERT INTO searches (ts, month, command_id, provider, query) VALUES (?, ?, ?, ?, ?)').run(ts, dayOf(ts).slice(0, 7), commandId, provider, query);
  }

  /** Web searches in the local month of `ts`. */
  searchesInMonth(ts: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM searches WHERE month = ?').get(dayOf(ts).slice(0, 7)) as { n: number }).n;
  }

  addReminder(at: number, text: string, now: number): Reminder {
    const r = this.db.prepare('INSERT INTO reminders (at, text, created) VALUES (?, ?, ?)').run(at, text, now);
    return { id: Number(r.lastInsertRowid), at, text };
  }

  /** Reminders not yet fired, soonest first. */
  pendingReminders(): Reminder[] {
    return this.db.prepare('SELECT id, at, text FROM reminders WHERE done = 0 ORDER BY at, id').all() as unknown as Reminder[];
  }

  /** Marks the reminders due at `now` as fired and returns them. */
  takeDueReminders(now: number): Reminder[] {
    const due = this.db.prepare('SELECT id, at, text FROM reminders WHERE done = 0 AND at <= ? ORDER BY at, id').all(now) as unknown as Reminder[];
    for (const r of due) this.db.prepare('UPDATE reminders SET done = 1 WHERE id = ?').run(r.id);
    return due;
  }

  /** Puts a reminder back in the queue at a new time (snooze). */
  rescheduleReminder(id: number, at: number): void {
    this.db.prepare('UPDATE reminders SET at = ?, done = 0 WHERE id = ?').run(at, id);
  }

  /** Cancels a pending reminder; false if there is none with that id. */
  cancelReminder(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM reminders WHERE id = ? AND done = 0').run(id).changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
