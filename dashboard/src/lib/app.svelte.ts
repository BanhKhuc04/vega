import { reduceMode, parseHash } from './modes';
import type { ModeEvent } from './modes';
import { makeSampleSnapshot } from './sample';
import { measureFps, parseLiteQuery, readStoredLite, resolveLite, writeStoredLite } from './lite';
import type { HistoryEntry, Mode, Snapshot, VegaDataSource } from './types';

export class AppStore {
  mode = $state<Mode>('idle');
  view = $state<'main' | 'core'>('main');
  snap = $state.raw<Snapshot>(makeSampleSnapshot(0));
  selectedId = $state<string | null>(null);
  lite = $state(false);
  now = $state(Date.now());

  private query = parseLiteQuery(typeof location === 'undefined' ? '' : location.search);
  private reducedMotion = false;
  private lowFps = false;
  private unsub: (() => void) | null = null;

  constructor(private readonly source: VegaDataSource) {
    this.snap = source.getSnapshot();
  }

  start(): () => void {
    this.unsub = this.source.subscribe((s) => (this.snap = s));
    this.source.start();

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = mq.matches;
    const onMq = () => {
      this.reducedMotion = mq.matches;
      this.recomputeLite();
    };
    mq.addEventListener('change', onMq);

    const onHash = () => this.applyHash();
    window.addEventListener('hashchange', onHash);
    this.applyHash();

    this.recomputeLite();
    // Auto-detect a slow device, unless the user or the URL already decided.
    if (!this.query && !readStoredLite() && !this.lite) {
      void measureFps(3000).then((fps) => {
        this.lowFps = fps < 30;
        this.recomputeLite();
      });
    }

    const tick = setInterval(() => (this.now = Date.now()), 15_000);
    return () => {
      clearInterval(tick);
      mq.removeEventListener('change', onMq);
      window.removeEventListener('hashchange', onHash);
      this.unsub?.();
      this.source.stop();
    };
  }

  private applyHash(): void {
    const r = parseHash(location.hash);
    this.view = r.view;
    if (r.view === 'main' && r.mode) this.mode = r.mode;
  }

  private recomputeLite(): void {
    this.lite = resolveLite({
      query: this.query,
      stored: readStoredLite(),
      reducedMotion: this.reducedMotion,
      lowFps: this.lowFps,
    });
  }

  toggleLite(): void {
    const next = !this.lite;
    writeStoredLite(next ? 'on' : 'off');
    this.query = null; // a manual choice beats the URL for the rest of this session
    this.lite = next;
  }

  dispatch(e: ModeEvent): void {
    this.mode = reduceMode(this.mode, e);
  }

  go(mode: Mode): void {
    this.dispatch({ type: 'goto', mode });
  }

  submit(text: string): boolean {
    const entry = this.source.sendCommand(text);
    if (!entry) return false;
    this.selectedId = entry.id;
    this.dispatch({ type: 'submit' });
    return true;
  }

  openHistory(entry: HistoryEntry): void {
    this.selectedId = entry.id;
    this.dispatch({ type: 'openHistoryItem' });
  }

  /** Session shown on the research screen: the selected history entry's, else the live one. */
  get session() {
    if (this.selectedId) {
      const h = this.snap.history.find((e) => e.id === this.selectedId);
      if (h?.session) return h.session;
    }
    return this.snap.research;
  }
}
