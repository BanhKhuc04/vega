import type { HistoryEntry, Snapshot, VegaDataSource } from './types';
import { makeSampleSession, makeSampleSnapshot } from './sample';

export interface MockOptions {
  now?: () => number;
}

export class MockSource implements VegaDataSource {
  readonly kind = 'mock' as const;
  private snap: Snapshot;
  private listeners = new Set<(s: Snapshot) => void>();
  private started = false;
  private counter: number;
  private readonly now: () => number;

  constructor(opts: MockOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.snap = makeSampleSnapshot(this.now());
    this.counter = 142;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.emit();
  }

  stop(): void {
    this.started = false;
  }

  getSnapshot(): Snapshot {
    return this.snap;
  }

  subscribe(listener: (s: Snapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snap);
    return () => this.listeners.delete(listener);
  }

  sendCommand(text: string): HistoryEntry | null {
    const clean = text.trim();
    if (!clean) return null;
    const ts = this.now();
    const id = `VG-${String(this.counter++).padStart(4, '0')}`;
    const session = makeSampleSession(id, `Nghiên cứu: ${clean}`, ts);
    const entry: HistoryEntry = { id, ts, text: clean, result: 'Đang xử lý (dữ liệu mẫu)', session };
    this.snap = {
      ...this.snap,
      research: session,
      core: 'thinking',
      history: [entry, ...this.snap.history],
    };
    this.emit();
    return entry;
  }

  private emit(): void {
    for (const l of this.listeners) l(this.snap);
  }
}
