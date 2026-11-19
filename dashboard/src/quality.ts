/** Render quality tiers (M0-6). full = template as designed; lite = no bloom, ~1,500 particles, DPR 1,
 *  no code rain, no scanlines; css = no WebGL context at all, the orb is drawn with CSS/SVG. */
export type Quality = 'full' | 'lite' | 'css';
export const QUALITIES: readonly Quality[] = ['full', 'lite', 'css'];
/** Tiers the owner can pick and the watchdog can fall to on a PC. `css` is only for `?quality=css` (the Pi kiosk),
 *  no WebGL, or reduced motion: it never comes from a slow frame rate or the header button. */
export const PICKABLE: readonly Quality[] = ['full', 'lite'];

export const FULL_MIN_FPS = 30;
export const FPS_WINDOW_MS = 3000;
export const FPS_WARMUP_MS = 1000;

export function parseQuality(v: unknown): Quality | null {
  return QUALITIES.find((q) => q === v) ?? null;
}

export function parseQualityQuery(search: string): Quality | null {
  return parseQuality(new URLSearchParams(search).get('quality'));
}

const KEY = 'vega.quality';

export function readStoredQuality(): Quality | null {
  try {
    const q = parseQuality(localStorage.getItem(KEY));
    return q && PICKABLE.includes(q) ? q : null; // an old stored `css` no longer pins the page to css
  } catch {
    return null;
  }
}

export function writeStoredQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    /* storage unavailable: the choice simply is not remembered */
  }
}

export interface ResolveInput {
  query: Quality | null;
  stored: Quality | null;
  reducedMotion: boolean;
  /** Only called when nothing else decided; probing creates a (temporary) WebGL context. */
  probeWebGL: () => boolean;
}

/** `auto` is true when the tier was not chosen by the user, so the FPS watchdog may lower it. */
export function resolveQuality(i: ResolveInput): { quality: Quality; auto: boolean } {
  if (i.query) return { quality: i.query, auto: false };
  if (i.stored) return { quality: i.stored, auto: false };
  if (i.reducedMotion) return { quality: 'css', auto: false };
  return { quality: i.probeWebGL() ? 'full' : 'css', auto: true };
}

export function probeWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The tier to fall back to for a measured FPS, or null if the current tier is fine. `lite` is the floor. */
export function nextQuality(current: Quality, fps: number): Quality | null {
  if (current === 'full' && fps < FULL_MIN_FPS) return 'lite';
  return null;
}

/**
 * Average FPS over fixed windows, after a warm-up. A very slow display (frames more than a second apart) must be
 * measured as slow, so there is no stall detection here: the caller resets the meter when the tab is hidden.
 */
export class FpsMeter {
  private start = -1;
  private windowStart = -1;
  private frames = 0;
  private last = -1;

  constructor(
    private readonly windowMs = FPS_WINDOW_MS,
    private readonly warmupMs = FPS_WARMUP_MS,
  ) {}

  reset(): void {
    this.start = this.windowStart = this.last = -1;
    this.frames = 0;
  }

  /** Feed each animation frame timestamp (ms). Returns the FPS when a window completes, else null. */
  tick(now: number): number | null {
    this.last = now;
    if (this.start < 0) {
      this.start = now;
      return null;
    }
    if (now - this.start < this.warmupMs) return null;
    if (this.windowStart < 0) {
      this.windowStart = now;
      this.frames = 0;
      return null;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed >= this.windowMs) {
      const fps = (this.frames * 1000) / elapsed;
      this.windowStart = now;
      this.frames = 0;
      return fps;
    }
    return null;
  }
}

/** Initial tier from URL, storage, media query and WebGL support. */
export function resolveInitialQuality(): { quality: Quality; auto: boolean } {
  return resolveQuality({
    query: parseQualityQuery(location.search),
    stored: readStoredQuality(),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    probeWebGL,
  });
}
