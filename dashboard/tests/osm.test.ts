// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScene } from '../src/scene/render';
import { ZOOM, metresPerPx, showOsm, tileOf } from '../src/ui/osm';
import { loadTemplate } from './dom';

const hooks = { setLog: vi.fn(), setVision: vi.fn() };
const HANOI = { lat: 21.0285, lon: 105.8542 };

beforeEach(() => loadTemplate());

describe('tile math', () => {
  it('Web Mercator tile numbers, as OSM counts them', () => {
    expect(tileOf(0, 0, 16)).toEqual({ x: 32768, y: 32768 });
    const t = tileOf(HANOI.lat, HANOI.lon, ZOOM);
    expect([Math.floor(t.x), Math.floor(t.y)]).toEqual([52038, 28850]);
    expect(metresPerPx(0, 16)).toBeCloseTo(2.389, 3);
  });
});

describe('showOsm', () => {
  it('5×3 tiles around the point, the accuracy ring, attribution and an Open in Maps link', () => {
    const box = document.createElement('div');
    showOsm(box, { ...HANOI, accuracyM: 30 }, () => {});
    const srcs = [...box.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).toHaveLength(15);
    expect(srcs[7]).toBe(`https://tile.openstreetmap.org/${ZOOM}/52038/28850.png`);
    expect(box.querySelector('.acc')).not.toBeNull();
    const links = [...box.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Open in Maps', '© OpenStreetMap']);
    expect(links[0]!.href).toBe('https://www.google.com/maps/search/?api=1&query=21.028500,105.854200');
    expect(links.every((a) => a.rel === 'noopener noreferrer' && a.target === '_blank')).toBe(true);
  });

  it('gives up when every tile fails (offline)', () => {
    const box = document.createElement('div');
    const fail = vi.fn();
    showOsm(box, HANOI, fail);
    const imgs = [...box.querySelectorAll('img')];
    imgs.slice(0, 14).forEach((i) => i.dispatchEvent(new Event('error')));
    expect(fail).not.toHaveBeenCalled();
    imgs[14]!.dispatchEvent(new Event('error'));
    expect(fail).toHaveBeenCalledOnce();
  });
});

describe('Locate scene', () => {
  it('a real position replaces the drawn map; a scene without one puts it back', () => {
    const map = document.querySelector<HTMLElement>('#map')!;
    map.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg')); // the template's drawn map (main.js)
    renderScene({ v: 1, scene: 'locate', data: { target: { name: 'away', lat: HANOI.lat, lon: HANOI.lon, accuracyM: 12 } } }, document, hooks);
    expect(map.querySelector('.osm')).not.toBeNull();
    expect(map.querySelector('svg')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-p=nmea]')!.hidden).toBe(true);
    renderScene({ v: 1, scene: 'locate' }, document, hooks);
    expect(map.querySelector('.osm')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-p=nmea]')!.hidden).toBe(false);
  });
});
