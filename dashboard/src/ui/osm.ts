/**
 * A real map for the Locate screen (M8, brief 0013 B11): 5×3 OpenStreetMap tiles around the phone's position, loaded by
 * the browser, tinted to the screen's palette, with the accuracy circle and an "Open in Maps" link. If no tile loads
 * (offline), `onFail` puts the template's drawn map back. OSM's tile policy: one user, attribution shown, no bulk preload.
 */
export const ZOOM = 16;
const TILE = 256;
/** Tiles across and down: enough to fill the map panel of a 1920 px screen. */
const COLS = 5;
const ROWS = 3;

/** Tile coordinates (fractional) of a point at `zoom`: Web Mercator, as OSM numbers its tiles. */
export function tileOf(lat: number, lon: number, zoom = ZOOM): { x: number; y: number } {
  const n = 2 ** zoom;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

/** Metres per screen pixel at `lat`. */
export const metresPerPx = (lat: number, zoom = ZOOM) => (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

function div(style: Partial<CSSStyleDeclaration>, cls = ''): HTMLDivElement {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  Object.assign(d.style, style);
  return d;
}

export function showOsm(box: HTMLElement, p: { lat: number; lon: number; accuracyM?: number }, onFail: () => void): void {
  const n = 2 ** ZOOM;
  const t = tileOf(p.lat, p.lon);
  const tx = Math.floor(t.x);
  const ty = Math.floor(t.y);
  const wrap = div({ position: 'relative', overflow: 'hidden', width: '100%', height: '100%', minHeight: '220px' }, 'osm');
  // the point sits at the centre of the box
  const cx = (COLS - 1) / 2;
  const cy = (ROWS - 1) / 2;
  const layer = div({ position: 'absolute', left: '50%', top: '50%', width: `${COLS * TILE}px`, height: `${ROWS * TILE}px`, transform: `translate(${-(cx * TILE + (t.x - tx) * TILE)}px, ${-(cy * TILE + (t.y - ty) * TILE)}px)`, filter: 'invert(1) hue-rotate(180deg) brightness(.8) contrast(.9) saturate(.55)' });
  let failed = 0;
  for (let dy = -cy; dy <= cy; dy++) {
    for (let dx = -cx; dx <= cx; dx++) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.width = TILE;
      img.height = TILE;
      Object.assign(img.style, { position: 'absolute', left: `${(dx + cx) * TILE}px`, top: `${(dy + cy) * TILE}px`, maxWidth: 'none' });
      img.addEventListener('error', () => {
        if (++failed === COLS * ROWS) onFail();
      });
      img.src = `https://tile.openstreetmap.org/${ZOOM}/${(((tx + dx) % n) + n) % n}/${ty + dy}.png`;
      layer.append(img);
    }
  }
  const r = p.accuracyM ? Math.min(400, Math.max(6, p.accuracyM / metresPerPx(p.lat))) : 0;
  const ring = r ? div({ position: 'absolute', left: '50%', top: '50%', width: `${2 * r}px`, height: `${2 * r}px`, transform: 'translate(-50%, -50%)', borderRadius: '50%', border: '1px solid currentColor', background: 'color-mix(in srgb, currentColor 14%, transparent)' }, 'acc') : null;
  const dot = div({ position: 'absolute', left: '50%', top: '50%', width: '12px', height: '12px', transform: 'translate(-50%, -50%)', borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 0 3px rgba(1,2,7,.8), 0 0 16px currentColor' }, 'osm-you');
  const foot = div({ position: 'absolute', right: '6px', bottom: '4px', display: 'flex', gap: '10px', fontSize: '11px' });
  const link = (href: string, text: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    a.style.color = 'inherit';
    return a;
  };
  foot.append(link(`https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`, 'Open in Maps'), link('https://www.openstreetmap.org/copyright', '© OpenStreetMap'));
  wrap.append(layer, ...(ring ? [ring] : []), dot, foot);
  box.replaceChildren(wrap);
}
