import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/vietnamese-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/vietnamese-700.css';
import { sceneExpiresAt } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { createDataSource } from '../data/datasource';
import { ACTIONS, PAGES, initialNav, keyOf, pageView, promptOf, sceneText, step } from './nav';
import type { Key } from './nav';

/** Paints the small front screen (mini.html). Text only through textContent: scene data comes from the network. */
const source = createDataSource();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, text = '', cls = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

let nav = initialNav();
let scene: SceneMessage | null = null;
let sceneUntil: number | null = null;
let toast = '';
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const mine = new Set<string>();

function showToast(text: string, ms = 8000): void {
  toast = text;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast = '';
    paint();
  }, ms);
}

function send(text: string): void {
  const id = source.sendCommand(text);
  if (id) mine.add(id);
  showToast(id ? `Đã gửi: ${text}` : 'Không gửi được: mất kết nối', id ? 4000 : 6000);
}

function paint(): void {
  const s = source.getSnapshot();
  const now = Date.now();
  if (scene && sceneUntil !== null && sceneUntil <= now) {
    scene = null;
    nav = { ...nav, prompt: null, choice: 0 }; // the brain stopped waiting for the answer
  }
  const d = new Date(now);
  $('clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('conn').dataset.state = s.conn;

  const page = PAGES[nav.page]!;
  const v = pageView(page, s, now);
  $('title').textContent = v.title;
  const big = $('big');
  big.textContent = v.big;
  big.classList.toggle('warn', !!v.warn);
  const body = $('body');
  body.replaceChildren();
  if (page === 'actions') {
    ACTIONS.forEach((a, i) => body.append(el('li', a.label, nav.inList && i === nav.item ? 'sel' : '')));
    body.append(el('li', nav.inList ? 'Xoay để chọn · nhấn để gửi · giữ để thoát' : 'Nhấn để mở', 'hint'));
  } else {
    for (const [k, val] of v.rows) {
      const li = el('li');
      li.append(el('span', k), el('b', val));
      body.append(li);
    }
  }
  $('dots').replaceChildren(...PAGES.map((_, i) => el('i', '', i === nav.page ? 'on' : '')));

  const sc = $('scene');
  sc.hidden = !scene || scene.scene === 'idle';
  if (scene && !sc.hidden) {
    const t = sceneText(scene);
    $('sLabel').textContent = t.label;
    $('sLine').textContent = t.line;
    sc.dataset.scene = scene.scene;
  }

  const pr = $('prompt');
  pr.hidden = !nav.prompt;
  if (nav.prompt) {
    $('pTitle').textContent = nav.prompt.title;
    $('pChoices').replaceChildren(...nav.prompt.choices.map((c, i) => el('li', c.label, i === nav.choice ? 'sel' : '')));
  }

  const tt = $('toast');
  tt.hidden = !toast;
  tt.textContent = toast;
}

function press(key: Key): void {
  // a scene on screen (not a question): any press goes back to the pages
  if (!nav.prompt && scene && scene.scene !== 'idle') {
    scene = null;
    return paint();
  }
  const asked = !!nav.prompt;
  const r = step(nav, key);
  nav = r.state;
  if (asked && !nav.prompt) scene = null; // answered (or dismissed): back to the pages, not to the alert card
  if (r.send) send(r.send);
  paint();
}

document.addEventListener('keydown', (e) => {
  const k = keyOf(e.key);
  if (!k || e.repeat) return;
  e.preventDefault();
  press(k);
});
// a knob set up as a mouse wheel instead of keys works too
let wheel = 0;
document.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    wheel += e.deltaY;
    if (Math.abs(wheel) < 40) return;
    press(wheel > 0 ? 'down' : 'up');
    wheel = 0;
  },
  { passive: false },
);

source.subscribe(() => paint());
source.onScene((sc) => {
  const now = Date.now();
  const until = sceneExpiresAt(sc, now);
  if (until !== null && until <= now) return;
  scene = sc;
  sceneUntil = until;
  const q = promptOf(sc);
  nav = { ...nav, prompt: q, choice: 0 };
  paint();
});
source.onResult((id, text) => {
  if (mine.delete(id)) showToast(text);
  paint();
});
source.onAnnounce((text) => {
  showToast(text, 15_000);
  paint();
});
source.start();
paint();
setInterval(paint, 15_000); // clock and "25 phút nữa" keep moving
