/**
 * Lite mode (D5). Precedence: ?lite=1|0 > stored manual choice > auto
 * (prefers-reduced-motion, or measured FPS < 30 in the first 3 seconds).
 */
export type LitePref = 'on' | 'off' | null;

export function parseLiteQuery(search: string): LitePref {
  const v = new URLSearchParams(search).get('lite');
  if (v === '1' || v === 'true') return 'on';
  if (v === '0' || v === 'false') return 'off';
  return null;
}

export function resolveLite(opts: { query: LitePref; stored: LitePref; reducedMotion: boolean; lowFps: boolean }): boolean {
  if (opts.query) return opts.query === 'on';
  if (opts.stored) return opts.stored === 'on';
  return opts.reducedMotion || opts.lowFps;
}

const KEY = 'vega.lite';

export function readStoredLite(): LitePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredLite(v: Exclude<LitePref, null>): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** Counts rAF frames for `ms` and resolves with the average FPS. */
export function measureFps(ms = 3000): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      frames++;
      const elapsed = t - start;
      if (elapsed >= ms) resolve((frames - 1) / (elapsed / 1000));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
