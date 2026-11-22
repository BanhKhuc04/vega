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
/** The phone's latest position (M8, OwnTracks). Only the latest is kept: no history. */
export interface Location {
  device: string;
  lat: number;
  lon: number;
  accM: number | null;
  /** When the phone took it, ms. */
  ts: number;
  regions: string[];
}
export interface CostRow {
  day: string;
  task: string;
  usd: number;
  calls: number;
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

export type MemoryKind = 'fact' | 'person' | 'routine' | 'event';
export type MemoryLevel = 'normal' | 'private';
export interface MemoryRow {
  id: number;
  kind: MemoryKind;
  level: MemoryLevel;
  text: string;
  /** A person or place name the item teaches, and its alias towards cloud AIs ("Người A"). */
  name: string | null;
  alias: string | null;
  pinned: boolean;
  created: number;
  /** Events are forgotten after 30 days unless pinned; null = kept. */
  expires: number | null;
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
      CREATE TABLE IF NOT EXISTS memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, level TEXT NOT NULL, text TEXT NOT NULL, name TEXT,
        alias TEXT, pinned INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, expires INTEGER
      );
      CREATE TABLE IF NOT EXISTS memory_sent (ts INTEGER NOT NULL, command_id TEXT NOT NULL, provider TEXT NOT NULL, memory_id INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_sent_id ON memory_sent (memory_id);
      CREATE TABLE IF NOT EXISTS home (id INTEGER PRIMARY KEY CHECK (id = 1), lat REAL NOT NULL, lon REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS location (
        id INTEGER PRIMARY KEY CHECK (id = 1), device TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, acc REAL,
        ts INTEGER NOT NULL, regions TEXT NOT NULL
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

  /** LLM calls of one kind of work on a local day (photos looked at: `vision`). */
  callsOn(day: string, task: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM llm_usage WHERE day = ? AND task = ?').get(day, task) as { n: number }).n;
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

  /** Replaces the one stored position. */
  saveLocation(l: Location): void {
    this.db
      .prepare('INSERT OR REPLACE INTO location (id, device, lat, lon, acc, ts, regions) VALUES (1, ?, ?, ?, ?, ?, ?)')
      .run(l.device, l.lat, l.lon, l.accM, l.ts, JSON.stringify(l.regions));
  }

  lastLocation(): Location | null {
    const r = this.db.prepare('SELECT device, lat, lon, acc, ts, regions FROM location WHERE id = 1').get() as { device: string; lat: number; lon: number; acc: number | null; ts: number; regions: string } | undefined;
    return r ? { device: r.device, lat: r.lat, lon: r.lon, accM: r.acc, ts: r.ts, regions: JSON.parse(r.regions) as string[] } : null;
  }

  // --- memory (M9, brief 0015): stays on the Pi; memory_sent keeps which items went to a cloud AI, never their text ---

  addMemory(m: Omit<MemoryRow, 'id'>): MemoryRow {
    const r = this.db
      .prepare('INSERT INTO memory (kind, level, text, name, alias, pinned, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.kind, m.level, m.text, m.name, m.alias, m.pinned ? 1 : 0, m.created, m.expires);
    return { ...m, id: Number(r.lastInsertRowid) };
  }

  /** Every item, oldest first, after dropping what has expired. */
  memories(now: number): MemoryRow[] {
    this.db.prepare('DELETE FROM memory WHERE expires IS NOT NULL AND expires <= ? AND pinned = 0').run(now);
    return (this.db.prepare('SELECT * FROM memory ORDER BY id').all() as (Omit<MemoryRow, 'pinned'> & { pinned: number })[]).map((r) => ({ ...r, pinned: r.pinned === 1 }));
  }

  updateMemory(id: number, set: { level?: MemoryLevel; pinned?: boolean }): boolean {
    const cur = this.db.prepare('SELECT level, pinned FROM memory WHERE id = ?').get(id) as { level: MemoryLevel; pinned: number } | undefined;
    if (!cur) return false;
    this.db.prepare('UPDATE memory SET level = ?, pinned = ? WHERE id = ?').run(set.level ?? cur.level, set.pinned === undefined ? cur.pinned : set.pinned ? 1 : 0, id);
    return true;
  }

  deleteMemory(id: number): boolean {
    this.db.prepare('DELETE FROM memory_sent WHERE memory_id = ?').run(id);
    return this.db.prepare('DELETE FROM memory WHERE id = ?').run(id).changes > 0;
  }

  clearMemory(): number {
    this.db.exec('DELETE FROM memory_sent');
    return Number(this.db.prepare('DELETE FROM memory').run().changes);
  }

  logMemorySent(ts: number, commandId: string, provider: string, ids: number[]): void {
    const q = this.db.prepare('INSERT INTO memory_sent (ts, command_id, provider, memory_id) VALUES (?, ?, ?, ?)');
    for (const id of ids) q.run(ts, commandId, provider, id);
  }

  /** Per item: how many commands sent it to a cloud AI, and when last. */
  memorySent(): Map<number, { n: number; last: number }> {
    const rows = this.db.prepare('SELECT memory_id AS id, COUNT(DISTINCT command_id) AS n, MAX(ts) AS last FROM memory_sent GROUP BY memory_id').all() as { id: number; n: number; last: number }[];
    return new Map(rows.map((r) => [r.id, { n: r.n, last: r.last }]));
  }

  /** Home set with "đây là nhà" (M8); it wins over HOME_LAT / HOME_LON. */
  saveHome(lat: number, lon: number): void {
    this.db.prepare('INSERT OR REPLACE INTO home (id, lat, lon) VALUES (1, ?, ?)').run(lat, lon);
  }

  savedHome(): { lat: number; lon: number } | null {
    return (this.db.prepare('SELECT lat, lon FROM home WHERE id = 1').get() as { lat: number; lon: number } | undefined) ?? null;
  }

  /** AI spending per local day and kind of work since `fromDay` (speech to text as task `stt`), newest day first. */
  costsSince(fromDay: string): CostRow[] {
    return this.db
      .prepare(
        `SELECT day, task, SUM(usd) AS usd, COUNT(*) AS calls FROM llm_usage WHERE day >= ? GROUP BY day, task
         UNION ALL SELECT day, 'stt' AS task, SUM(usd) AS usd, COUNT(*) AS calls FROM stt_usage WHERE day >= ? GROUP BY day
         ORDER BY day DESC, task`,
      )
      .all(fromDay, fromDay) as unknown as CostRow[];
  }

  /** When a command last used a tool whose chip starts with `prefix` (the camera: `look`); null if never. */
  lastToolUse(prefix: string): number | null {
    // prefix comes from code (a tool name), never from a user: no LIKE escaping needed
    const r = this.db.prepare('SELECT MAX(ts) AS ts FROM commands WHERE tools LIKE ?').get(`%"${prefix}%`) as { ts: number | null };
    return r.ts;
  }

  close(): void {
    this.db.close();
  }
}
