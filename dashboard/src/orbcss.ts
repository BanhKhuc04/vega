/**
 * CSS/SVG rendition of the VEGA orb for the `css` quality tier (no WebGL context is ever created).
 * Same ring layout and colours as the three.js scene in main.js; each ring is its own composited layer
 * animated with CSS transforms only, so it stays cheap on a Raspberry Pi 3.
 */
const NS = 'http://www.w3.org/2000/svg';
const U = 50; // px per world unit inside the 260x260 viewBox (outer radius 2.6 -> 130)

type Tone = 'ring' | 'light' | 'dark';
type Move =
  | { k: 'spin'; sp: number }
  | { k: 'wave'; sp: number }
  | { k: 'step'; A: number; per: number; dir: 1 | -1 }
  | { k: 'swing'; A: number; f: number; ph: number }
  | { k: 'breath' };
interface Ring {
  rIn: number;
  rOut: number;
  arcs?: [number, number][];
  dashes?: [number, number];
  op: number;
  mv: Move;
  tone: Tone;
  tilt?: number; // radians, flattens the orbit
}

const RINGS: Ring[] = [
  { rIn: 1.515, rOut: 1.545, arcs: [[0, 110], [120, 230], [240, 350]], op: 0.9, mv: { k: 'step', A: 120, per: 4.2, dir: 1 }, tone: 'ring' },
  { rIn: 1.6, rOut: 1.606, arcs: [[0, 320]], op: 0.45, mv: { k: 'spin', sp: 0.9 }, tone: 'light' },
  { rIn: 1.7, rOut: 1.765, dashes: [120, 0.22], op: 0.5, mv: { k: 'spin', sp: -0.08 }, tone: 'light' },
  { rIn: 1.66, rOut: 1.83, dashes: [12, 0.035], op: 0.8, mv: { k: 'step', A: 30, per: 2.6, dir: -1 }, tone: 'light' },
  { rIn: 1.4, rOut: 1.407, arcs: [[20, 160], [200, 340]], op: 0.55, mv: { k: 'wave', sp: -0.5 }, tone: 'light' },
  { rIn: 1.88, rOut: 1.888, arcs: [[0, 70], [90, 200], [230, 300]], op: 0.5, mv: { k: 'wave', sp: 0.22 }, tone: 'ring' },
  { rIn: 2.02, rOut: 2.03, arcs: [[30, 150], [210, 330]], op: 0.55, mv: { k: 'wave', sp: -0.16 }, tone: 'ring' },
  { rIn: 2.16, rOut: 2.166, arcs: [[0, 45], [65, 175], [180, 225], [245, 355]], op: 0.4, mv: { k: 'wave', sp: 0.1 }, tone: 'light' },
  { rIn: 2.3, rOut: 2.314, dashes: [90, 0.5], op: 0.3, mv: { k: 'spin', sp: 0.04 }, tone: 'ring' },
  { rIn: 1.95, rOut: 1.985, arcs: [[0, 150], [180, 330]], op: 0.7, mv: { k: 'spin', sp: 0.55 }, tone: 'dark', tilt: 1.2 },
  { rIn: 2.1, rOut: 2.11, arcs: [[20, 160], [200, 340]], op: 0.5, mv: { k: 'spin', sp: -0.4 }, tone: 'ring', tilt: -1.2 },
  { rIn: 1.75, rOut: 1.757, arcs: [[0, 300]], op: 0.3, mv: { k: 'spin', sp: 0.3 }, tone: 'light', tilt: 1.45 },
  { rIn: 1.115, rOut: 1.15, arcs: [[0, 360]], op: 0.75, mv: { k: 'breath' }, tone: 'light' },
  { rIn: 1.165, rOut: 1.195, dashes: [72, 0.3], op: 0.45, mv: { k: 'spin', sp: 0.12 }, tone: 'light' },
  { rIn: 1.22, rOut: 1.27, arcs: [[35, 55], [125, 145], [215, 235], [305, 325]], op: 0.85, mv: { k: 'step', A: 90, per: 2.4, dir: -1 }, tone: 'ring' },
  { rIn: 2.56, rOut: 2.575, arcs: [[-28, 28], [152, 208]], op: 0.7, mv: { k: 'swing', A: 14, f: 0.55, ph: 0 }, tone: 'light' },
  { rIn: 2.62, rOut: 2.627, arcs: [[-40, -32], [32, 40], [140, 148], [212, 220]], op: 0.6, mv: { k: 'swing', A: 22, f: 0.55, ph: Math.PI }, tone: 'light' },
];

const el = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
};

const pt = (r: number, deg: number): string => {
  const a = (deg * Math.PI) / 180;
  return `${(Math.cos(a) * r).toFixed(2)} ${(-Math.sin(a) * r).toFixed(2)}`;
};

function ringPath(r: number, arcs: [number, number][]): string {
  return arcs
    .map(([a0, a1]) => {
      if (a1 - a0 >= 359.9) return `M ${pt(r, 0)} A ${r} ${r} 0 1 0 ${pt(r, 180)} A ${r} ${r} 0 1 0 ${pt(r, 360)}`;
      return `M ${pt(r, a0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 0 ${pt(r, a1)}`;
    })
    .join(' ');
}

function buildRing(r: Ring, i: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `oc-layer oc-${r.tone}`;
  if (r.tilt) wrap.style.transform = `scaleY(${Math.abs(Math.cos(r.tilt)).toFixed(3)})`;
  const svg = el('svg', { viewBox: '-130 -130 260 260', 'aria-hidden': 'true' }) as SVGSVGElement;
  const mid = ((r.rIn + r.rOut) / 2) * U;
  const w = Math.max(0.6, (r.rOut - r.rIn) * U);
  let node: SVGElement;
  if (r.dashes) {
    const [n, f] = r.dashes;
    const c = 2 * Math.PI * mid;
    node = el('circle', { r: mid, fill: 'none', 'stroke-width': w, 'stroke-dasharray': `${((c / n) * f).toFixed(2)} ${((c / n) * (1 - f)).toFixed(2)}` });
  } else {
    node = el('path', { d: ringPath(mid, r.arcs ?? []), fill: 'none', 'stroke-width': w });
  }
  node.setAttribute('stroke-opacity', String(r.op));
  svg.appendChild(node);
  wrap.appendChild(svg);
  const m = r.mv;
  svg.classList.add('oc-mv');
  const s = svg.style;
  if (m.k === 'spin' || m.k === 'wave') {
    const period = (2 * Math.PI) / Math.abs(m.sp);
    s.setProperty('--p', `${period.toFixed(1)}s`);
    svg.classList.add(m.sp > 0 ? 'oc-spin-ccw' : 'oc-spin-cw');
  } else if (m.k === 'step') {
    s.setProperty('--p', `${m.per}s`);
    s.setProperty('--A', `${-m.dir * m.A}deg`); // three.js +z is counter-clockwise, CSS +deg is clockwise
    svg.classList.add('oc-step');
  } else if (m.k === 'swing') {
    s.setProperty('--p', `${((2 * Math.PI) / m.f).toFixed(1)}s`);
    s.setProperty('--A', `${m.A}deg`);
    s.animationDelay = `${(-(m.ph / (2 * Math.PI)) * ((2 * Math.PI) / m.f)).toFixed(2)}s`;
    svg.classList.add('oc-swing');
  } else {
    svg.classList.add('oc-breath');
  }
  if (i === 0) {
    for (const a of [110, 230, 350]) {
      const [x, y] = pt(mid, a).split(' ');
      svg.appendChild(el('circle', { cx: x ?? 0, cy: y ?? 0, r: 1.6, fill: '#e8f6ff', stroke: 'none' }));
    }
  }
  return wrap;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export interface CssOrb {
  el: HTMLElement;
  /** Centre and outer radius in CSS px, plus 0..1 glow/dim factors. */
  update(x: number, y: number, radius: number, glow: number, dim: number): void;
  /** Ring-speed multiplier of the current mode (same meaning as MODES[m].look.ring). */
  setSpeed(v: number): void;
  destroy(): void;
}

export function createCssOrb(host: HTMLElement, before: Element | null): CssOrb {
  const root = document.createElement('div');
  root.id = 'orbCss';
  root.setAttribute('aria-hidden', 'true');
  const glow = document.createElement('div');
  glow.className = 'oc-glow';
  root.appendChild(glow);
  RINGS.forEach((r, i) => root.appendChild(buildRing(r, i)));

  const core = document.createElement('div');
  core.className = 'oc-layer';
  const cs = el('svg', { viewBox: '-130 -130 260 260' }) as SVGSVGElement;
  const defs = el('defs');
  const grad = el('radialGradient', { id: 'ocCoreGrad' });
  [[0, 0], [0.62, 0.05], [0.88, 0.5], [1, 0.9]].forEach(([o, a]) => {
    const st = el('stop', { offset: o ?? 0 });
    st.setAttribute('style', `stop-color:var(--accent);stop-opacity:${a}`);
    grad.appendChild(st);
  });
  defs.appendChild(grad);
  cs.appendChild(defs);
  cs.appendChild(el('circle', { r: 0.92 * U, fill: 'url(#ocCoreGrad)' }));
  cs.appendChild(el('circle', { r: 0.92 * U, fill: 'none', stroke: '#e8f6ff', 'stroke-opacity': 0.28, 'stroke-width': 1 }));
  cs.appendChild(el('circle', { r: 1.12 * U, fill: 'none', stroke: 'var(--accent)', 'stroke-opacity': 0.1, 'stroke-width': 0.6, 'stroke-dasharray': '2 5' }));
  core.appendChild(cs);
  core.classList.add('oc-core');
  root.appendChild(core);

  for (const k of [0, 1]) {
    const w = document.createElement('div');
    w.className = 'oc-wave';
    w.style.animationDelay = `${k * 1.2}s`;
    root.appendChild(w);
  }
  const band = document.createElement('div');
  band.className = 'oc-band';
  root.appendChild(band);

  // comets: a dot with a short fading tail on its own orbit
  [[2.05, 1.1, 0], [2.35, -0.8, 1], [1.85, 0.7, 2], [2.45, -0.55, 3]].forEach(([r, sp, n]) => {
    const w = document.createElement('div');
    w.className = 'oc-layer oc-mv ' + ((sp ?? 1) > 0 ? 'oc-spin-ccw' : 'oc-spin-cw');
    w.style.setProperty('--p', `${((2 * Math.PI) / Math.abs(sp ?? 1)).toFixed(1)}s`);
    w.style.animationDelay = `${-(n ?? 0) * 1.7}s`;
    const svg = el('svg', { viewBox: '-130 -130 260 260' });
    const rr = (r ?? 2) * U;
    svg.appendChild(el('path', { d: `M ${pt(rr, 0)} A ${rr} ${rr} 0 0 ${(sp ?? 1) > 0 ? 1 : 0} ${pt(rr, (sp ?? 1) > 0 ? -22 : 22)}`, fill: 'none', stroke: 'var(--accent)', 'stroke-opacity': 0.55, 'stroke-width': 1 }));
    svg.appendChild(el('circle', { cx: rr, cy: 0, r: 2, fill: '#e8f6ff' }));
    w.appendChild(svg);
    root.appendChild(w);
  });

  // particles
  const rnd = seeded(7);
  const pw = document.createElement('div');
  pw.className = 'oc-layer';
  const ps = el('svg', { viewBox: '-130 -130 260 260' });
  for (let i = 0; i < 48; i++) {
    const a = rnd() * Math.PI * 2;
    const r = (1.4 + Math.pow(rnd(), 1.6) * 1.45) * U;
    const c = el('circle', { cx: (Math.cos(a) * r).toFixed(1), cy: (Math.sin(a) * r).toFixed(1), r: (0.6 + rnd() * 1.4).toFixed(2), fill: '#bfe6ff' });
    c.setAttribute('class', 'oc-tw');
    c.setAttribute('style', `animation-delay:${(-rnd() * 2.6).toFixed(2)}s`);
    ps.appendChild(c);
  }
  pw.appendChild(ps);
  root.appendChild(pw);

  host.insertBefore(root, before);

  let lastGlow = -1;
  return {
    el: root,
    update(x, y, radius, g, dim) {
      const size = Math.max(2, radius * 2);
      root.style.width = root.style.height = `${size.toFixed(1)}px`;
      root.style.transform = `translate(${(x - radius).toFixed(1)}px,${(y - radius).toFixed(1)}px)`;
      const o = Math.max(0, Math.min(1, g * 1.1)) * Math.max(0.25, Math.min(1, dim * 1.3));
      if (Math.abs(o - lastGlow) > 0.01) {
        lastGlow = o;
        root.style.opacity = o.toFixed(2);
      }
    },
    setSpeed(v) {
      root.style.setProperty('--rs', String(Math.max(0.2, v)));
    },
    destroy() {
      root.remove();
    },
  };
}
