import { SCENES } from '@vega/contract';
import type { SceneMessage, SceneName } from '@vega/contract';

/**
 * Pours scene `data` into the template's DOM. Every field is optional: a missing field restores the text and
 * numbers the template shipped with (remembered the first time each element is touched). Nothing from the
 * network is ever inserted as HTML; text goes through `textContent` and lists are built with DOM calls.
 */
interface Pristine {
  text: string;
  html: string;
  data: Map<string, string | undefined>;
}
const pristine = new WeakMap<Element, Pristine>();

function pr(el: Element): Pristine {
  let p = pristine.get(el);
  if (!p) {
    p = { text: el.textContent ?? '', html: el.innerHTML, data: new Map() };
    pristine.set(el, p);
  }
  return p;
}

export interface Hooks {
  setLog(entries: [string, string][] | null): void;
}

type Q = <T extends Element = HTMLElement>(sel: string) => T | null;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const n2 = (n: number) => String(n).padStart(2, '0');

function text(el: Element | null, v: string | undefined): void {
  if (!el) return;
  const p = pr(el);
  el.textContent = v ?? p.text;
  if (el instanceof HTMLElement && el.dataset.scr !== undefined) delete el.dataset.final; // header re-caches at reveal
}
function heading(el: Element | null, prefix: string, v: string | undefined): void {
  text(el, v === undefined ? undefined : `${prefix} // ${v}`);
}
function dataAttr(el: HTMLElement | null, key: string, v: string | undefined): void {
  if (!el) return;
  const p = pr(el);
  if (!p.data.has(key)) p.data.set(key, el.dataset[key]);
  const base = p.data.get(key);
  const val = v ?? base;
  if (val === undefined) delete el.dataset[key];
  else el.dataset[key] = val;
}
function list<T>(el: Element | null, items: T[] | undefined, build: (item: T, i: number) => Node): void {
  if (!el) return;
  const p = pr(el);
  if (!items) el.innerHTML = p.html;
  else el.replaceChildren(...items.map(build));
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
/** Replaces the last text node of `el` (used where the template mixes a tag and a trailing label). */
function setTail(el: Element | null, v: string | undefined): void {
  if (!el) return;
  const p = pr(el);
  if (v === undefined) {
    el.innerHTML = p.html;
    return;
  }
  const last = el.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) last.textContent = v;
  else el.append(v);
}

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- per-scene shape is validated by @vega/contract

const R: Record<SceneName, (d: Data, q: Q, h: Hooks) => void> = {
  idle(d, q) {
    const cap = q('#caption');
    dataAttr(cap, 'text', d.caption);
    text(cap, d.caption);
  },
  listen(d, q) {
    const t = q('#transcript');
    dataAttr(t, 'text', d.transcript);
    if (t) t.textContent = '';
    text(q('[data-tpl=listen] .hint'), d.hint);
  },
  think(d, q) {
    list(q('#chips'), d.chips, (c: { label: string; state: string }) => {
      const e = node('span', 'chip', c.label);
      e.dataset.s = c.state;
      return e;
    });
    const p = q('#plan');
    dataAttr(p, 'text', d.plan);
    text(p, d.plan);
  },
  research(d, q, h) {
    text(q('#rtitle'), d.title);
    const st = d.step as { current: number; total: number; label: string } | undefined;
    text(q('[data-tpl=research] .rstep'), st && `step ${st.current}/${st.total} · ${st.label}`);
    // stat
    const s = d.stat as { sources: number; text?: string; ref?: string; progress?: number } | undefined;
    dataAttr(q('#srcCount'), 'to', s && String(s.sources));
    text(q('[data-p=stat] > .t'), s?.text);
    text(q('[data-p=stat] .hd .id'), s?.ref);
    dataAttr(q('#srcMeter'), 'to', s?.progress === undefined ? undefined : String(Math.round(s.progress * 100)));
    // chart
    const c = d.chart as { title?: string; values: number[]; thresholdPpm?: number; maxPpm?: number; summary?: string; footnote?: string } | undefined;
    heading(q('[data-p=co2] .hd [data-scr]'), 'chart', c?.title);
    const bars = q('#bars');
    const thr = q('[data-p=co2] .thr');
    const labels = q('[data-p=co2] .thr span');
    const yax = q('[data-p=co2] .yax');
    const summary = q('[data-p=co2] .t.x-only');
    const foot = q('[data-p=co2] .row > .t');
    if (c && bars && thr) {
      const max = c.maxPpm ?? 1500;
      const limit = c.thresholdPpm ?? 1000;
      bars.replaceChildren(
        ...c.values.map((v) => {
          const i = node('i', v > limit ? 'w' : '');
          i.style.height = `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
          return i;
        }),
      );
      thr.style.bottom = `${Math.min(100, (limit / max) * 100).toFixed(2)}%`;
      text(labels, `threshold ${fmt(limit)} ppm`);
      if (yax) yax.replaceChildren(...[max, (max * 2) / 3, max / 3, 0].map((v) => node('span', '', fmt(v))));
      let peak = 0;
      c.values.forEach((v, i) => (v > c.values[peak]! ? (peak = i) : 0));
      if (c.summary !== undefined) text(summary, c.summary);
      else if (summary) {
        const b = node('b', 'w', `${fmt(c.values[peak]!)} ppm at ${n2(peak)}:00`);
        summary.replaceChildren('Peak ', b, '.');
      }
      const over = c.values.filter((v) => v > limit).length;
      text(foot, c.footnote ?? (over ? `Above threshold for ${over} h` : 'Within range all day'));
    } else {
      for (const el of [bars, labels, yax, summary, foot]) if (el) el.innerHTML = pr(el).html;
      if (thr) {
        thr.style.bottom = '';
        if (!thr.getAttribute('style')) thr.removeAttribute('style');
      }
    }
    // steps
    list(q('#steps'), d.steps, (x: { label: string; state: string }) => {
      const li = node('li', '', x.label);
      li.dataset.s = x.state;
      return li;
    });
    // source
    const src = d.source as { title?: string; caption?: string } | undefined;
    heading(q('[data-p=source] .hd [data-scr]'), 'source', src?.title);
    text(q('[data-p=source] .t.hl'), src?.caption);
    // compare
    const cmp = d.compare as
      | { title: string; columns: string[]; rows: { label: string; cells: { text: string; tone?: string }[] }[] }
      | undefined;
    heading(q('[data-p=compare] .hd [data-scr]'), 'compare', cmp?.title);
    const head = q('.cmp thead');
    const body = q('.cmp tbody');
    if (cmp && head && body) {
      const tr = node('tr');
      for (const col of cmp.columns) {
        const th = node('th', '', col);
        th.scope = 'col';
        tr.append(th);
      }
      head.replaceChildren(tr);
      body.replaceChildren(
        ...cmp.rows.map((r) => {
          const row = node('tr');
          row.append(node('td', '', r.label));
          for (const cell of r.cells) row.append(node('td', cell.tone === 'ok' ? 'ok' : cell.tone === 'warn' ? 'w' : '', cell.text));
          return row;
        }),
      );
    } else {
      if (head) head.innerHTML = pr(head).html;
      if (body) body.innerHTML = pr(body).html;
    }
    // note
    const note = q('#note');
    const nt = d.note as { text: string; refs?: string } | undefined;
    dataAttr(note, 'text', nt?.text);
    if (note) note.textContent = '';
    text(q('[data-p=note] > span.id'), nt?.refs);
    // log
    h.setLog(d.log ? (d.log as { tag: string; msg: string }[]).map((l) => [l.tag, l.msg]) : null);
  },
  locate(d, q) {
    text(q('[data-tpl=locate] .rhead h1'), d.title);
    text(q('[data-tpl=locate] .rstep'), d.status);
    const t = d.target as { name?: string; distanceKm?: number; detail?: string; coord?: string } | undefined;
    heading(q('[data-p=target] .hd [data-scr]'), 'target', t?.name);
    dataAttr(q('#dist'), 'to', t?.distanceKm === undefined ? undefined : String(t.distanceKm));
    text(q('[data-p=target] .t'), t?.detail);
    text(q('[data-p=target] .coord'), t?.coord);
    const r = d.route as { title?: string; steps: string[] } | undefined;
    heading(q('[data-p=route] .hd [data-scr]'), 'route', r?.title ?? (r ? `${r.steps.length} turns` : undefined));
    list(q('.turns'), r?.steps, (s: string) => node('li', '', s));
  },
  vision(d, q) {
    setTail(q('.vhud.tl'), d.camera === undefined ? undefined : String(d.camera));
  },
  briefing(d, q) {
    text(q('.greet .k'), d.kicker);
    text(q('.greet h1'), d.title);
    text(q('.greet p'), d.summary);
    const ag = d.agenda as { time: string; title: string; hot?: boolean }[] | undefined;
    // a single "—" row is the brain saying the list is empty ("Nothing on the calendar"), not one event
    const nAg = ag?.filter((e) => e.time !== '—').length;
    heading(q('[data-p=b1] .hd [data-scr]'), 'today', ag && `${nAg} event${nAg === 1 ? '' : 's'}`);
    list(q('[data-p=b1] .agenda'), ag, (e) => {
      const li = node('li', e.hot ? 'hot' : '');
      li.append(node('b', '', e.time), e.title);
      return li;
    });
    const inbox = d.inbox as { from: string; subject: string }[] | undefined;
    const nIn = inbox?.filter((e) => e.from !== '—').length;
    heading(q('[data-p=b2] .hd [data-scr]'), 'inbox', inbox && (nIn ? `${nIn} unread` : 'empty'));
    list(q('[data-p=b2] .agenda'), inbox, (e) => {
      const li = node('li');
      li.append(node('b', '', e.from), e.subject);
      return li;
    });
    const room = q('[data-p=b3] .t');
    if (room) {
      if (d.room === undefined) room.innerHTML = pr(room).html;
      else room.textContent = d.room;
    }
    const builds = d.builds as { passing: number; failing: number; repo?: string } | undefined;
    const bt = q('[data-p=b4] .t');
    if (bt) {
      if (!builds) bt.innerHTML = pr(bt).html;
      else {
        bt.replaceChildren(node('b', 'ok', `${builds.passing} passing`), ' · ', node('b', 'bad', `${builds.failing} failing`), builds.repo && builds.failing ? ` (${builds.repo})` : '');
      }
    }
  },
  focus(d, q) {
    text(q('[data-tpl=focus] > .k'), d.kicker);
    const timer = q('#timer');
    dataAttr(timer, 'total', d.minutes === undefined ? undefined : String(d.minutes * 60));
    if (timer) timer.textContent = d.minutes === undefined ? pr(timer).text : `${n2(d.minutes)}:00`;
    text(q('[data-tpl=focus] .hint'), d.hint);
  },
  alert(d, q) {
    heading(q('.alert-card .hd [data-scr]'), 'critical', d.title);
    text(q('.alert-card .hd .id'), d.ref);
    text(q('.alert-card .err'), d.error);
    text(q('.alert-card > .t'), d.note);
    for (const sel of ['#aConfirm', '#aCancel']) {
      const b = q(sel);
      if (b) b.hidden = !d.confirm; // Confirm / Cancel only on a confirmation card from the brain
    }
    const ex = q('#aExplain');
    if (ex) ex.hidden = !d.explain;
    const later = q('#aLater');
    if (later) later.hidden = !d.snooze;
    const open = q('#aOpen');
    if (open) {
      open.hidden = !d.url; // https only (checked by the contract)
      if (d.url) open.dataset.url = d.url;
      else delete open.dataset.url;
    }
  },
  success(d, q) {
    heading(q('[data-tpl=success] .hd [data-scr]'), 'deployed', d.title);
    text(q('[data-tpl=success] .hd .id'), d.ref);
    list(q('.checks'), d.checks, (c: string) => node('li', '', c));
  },
  sleep(d, q) {
    text(q('.night'), d.title);
    // hint first: restoring its pristine HTML re-creates #lightsOff, so look that element up afterwards
    const hint = q('[data-tpl=sleep] .hint');
    if (hint) {
      if (d.alarm === undefined && d.dnd === undefined) hint.innerHTML = pr(hint).html;
      else setTail(hint, ` s · alarm ${d.alarm ?? '07:00'} · do not disturb ${d.dnd === false ? 'off' : 'on'}`);
    }
    const n = q('#lightsOff');
    dataAttr(n, 'from', d.lightsOffSeconds === undefined ? undefined : String(d.lightsOffSeconds));
    if (n) n.textContent = d.lightsOffSeconds === undefined ? pr(n).text : String(d.lightsOffSeconds);
  },
};

/** Writes the data of `scene` into the template (missing fields -> template defaults). */
export function renderScene(scene: SceneMessage, root: ParentNode, hooks: Hooks): void {
  // Registering on lookup means the pristine copy is taken before anything here modifies the element.
  const q: Q = <T extends Element = HTMLElement>(sel: string) => {
    const el = root.querySelector<T>(sel);
    if (el) pr(el);
    return el;
  };
  R[scene.scene]((scene.data ?? {}) as Data, q, hooks);
}

/** Remembers the template's own text everywhere a scene can write. Call once, before any animation runs. */
export function capturePristine(root: ParentNode, hooks: Hooks): void {
  for (const scene of SCENES) renderScene({ v: 1, scene } as SceneMessage, root, hooks);
}
