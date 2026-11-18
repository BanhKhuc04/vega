// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENES, parseScene } from '@vega/contract';
import type { SceneMessage, SceneName } from '@vega/contract';
import { renderScene } from '../src/scene/render';
import { loadTemplate, sectionsHtml } from './dom';

const EX = resolve(import.meta.dirname, '../../tools/sim/examples');
const example = (name: SceneName): SceneMessage => {
  const r = parseScene(readFileSync(resolve(EX, `${name}.json`), 'utf8'));
  if (!r.ok) throw new Error(`${name}.json: ${r.error}`);
  return r.scene;
};
const hooks = { setLog: vi.fn() };
const $ = (s: string) => document.querySelector<HTMLElement>(s)!;
const bare = (scene: SceneName): SceneMessage => ({ v: 1, scene });

beforeEach(() => {
  loadTemplate();
  hooks.setLog.mockClear();
});

describe('examples', () => {
  it('there is one valid example per template', () => {
    const files = readdirSync(EX).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
    expect(files).toEqual([...SCENES].sort());
  });
});

describe('renderScene fills the template from data', () => {
  it('idle / listen / think', () => {
    renderScene(example('idle'), document, hooks);
    expect($('#caption').textContent).toBe('Standing by · all quiet');
    expect($('#caption').dataset.text).toBe('Standing by · all quiet');
    renderScene(example('listen'), document, hooks);
    expect($('#transcript').dataset.text).toContain('temperature in the bedroom');
    expect($('#transcript').textContent).toBe('');
    renderScene(example('think'), document, hooks);
    expect([...document.querySelectorAll('#chips .chip')].map((c) => [c.textContent, (c as HTMLElement).dataset.s])).toEqual([
      ['Parse intent', 'done'], ['Query room sensors', 'done'], ['Draft answer', 'run'],
    ]);
    expect($('#plan').dataset.text).toBe('→ room.read(bedroom) · window.state()');
  });

  it('research: title, step, stat, chart, steps, source, compare, note, log', () => {
    renderScene(example('research'), document, hooks);
    expect($('#rtitle').textContent).toBe('Research: standing desk height for a 178 cm user');
    expect($('[data-tpl=research] .rstep').textContent).toBe('step 4/5 · comparing sources');
    expect($('#srcCount').dataset.to).toBe('9');
    expect($('#srcMeter').dataset.to).toBe('80');
    expect($('[data-p=stat] > .t').textContent).toContain('ergonomics guides');
    expect($('[data-p=stat] .hd .id').textContent).toBe('vg-0207');
    expect(document.querySelectorAll('#bars i')).toHaveLength(24);
    expect(document.querySelectorAll('#bars i.w').length).toBe(9); // values above 1000
    expect($('[data-p=co2] .thr').style.bottom).toBe('66.67%');
    expect($('[data-p=co2] .thr span').textContent).toBe('threshold 1,000 ppm');
    expect([...document.querySelectorAll('[data-p=co2] .yax span')].map((s) => s.textContent)).toEqual(['1,500', '1,000', '500', '0']);
    expect($('[data-p=co2] .t.x-only').textContent).toContain('Peak 1,300 ppm at 07:00');
    expect($('[data-p=co2] .row > .t').textContent).toBe('Above threshold 8 h');
    expect([...document.querySelectorAll('#steps li')].map((l) => (l as HTMLElement).dataset.s)).toEqual(['done', 'done', 'done', 'run', 'wait']);
    expect($('[data-p=source] .t.hl').textContent).toBe('Elbows at 90° when typing');
    expect($('[data-p=compare] .hd [data-scr]').textContent).toBe('compare // fixed vs electric');
    expect([...document.querySelectorAll('.cmp thead th')].map((t) => t.textContent)).toEqual(['Criterion', 'Fixed', 'Electric']);
    expect(document.querySelectorAll('.cmp tbody tr')).toHaveLength(3);
    expect(document.querySelector('.cmp tbody tr td.ok')?.textContent).toBe('62–128 cm');
    expect(document.querySelector('.cmp tbody tr td.w')?.textContent).toBe('One setting');
    expect($('#note').dataset.text).toContain('elbows sit at about 90°');
    expect($('[data-p=note] > span.id').textContent).toBe('sources [2] [5] · verified');
    expect(hooks.setLog).toHaveBeenCalledWith(expect.arrayContaining([['agent', 'Parsed request → desk height for 178 cm']]));
  });

  it('research chart without summary computes the peak', () => {
    renderScene({ v: 1, scene: 'research', data: { chart: { values: [10, 50, 20] } } }, document, hooks);
    expect($('[data-p=co2] .t.x-only').textContent).toBe('Peak 50 ppm at 01:00.');
    expect($('[data-p=co2] .row > .t').textContent).toBe('Within range all day');
  });

  it('locate / vision / briefing / focus / alert / success / sleep', () => {
    renderScene(example('locate'), document, hooks);
    expect($('[data-tpl=locate] .rhead h1').textContent).toBe('Locate: nearest pharmacy');
    expect($('#dist').dataset.to).toBe('0.8');
    expect(document.querySelectorAll('.turns li')).toHaveLength(3);
    expect($('[data-p=target] .coord').textContent).toContain('10.7712');
    renderScene(example('vision'), document, hooks);
    expect($('.vhud.tl').textContent).toContain('CAM-01 · DESK');
    expect($('.vhud.tl .rec')).not.toBeNull();
    renderScene(example('briefing'), document, hooks);
    expect($('.greet .k').textContent).toBe('Thu · 19 Nov · morning briefing');
    expect($('[data-p=b1] .hd [data-scr]').textContent).toBe('today // 2 events');
    expect(document.querySelector('[data-p=b1] .agenda li.hot b')?.textContent).toBe('15:30');
    expect($('[data-p=b2] .hd [data-scr]').textContent).toBe('inbox // 1 that matter');
    expect($('[data-p=b4] .t').textContent).toBe('3 passing · 0 failing');
    renderScene(example('focus'), document, hooks);
    expect($('#timer').dataset.total).toBe('3000');
    expect($('#timer').textContent).toBe('50:00');
    renderScene(example('alert'), document, hooks);
    expect($('.alert-card .err').textContent).toContain('TS2345');
    expect($('.alert-card .hd [data-scr]').textContent).toBe('critical // build failed');
    renderScene(example('success'), document, hooks);
    expect(document.querySelectorAll('.checks li')).toHaveLength(3);
    renderScene(example('sleep'), document, hooks);
    expect($('#lightsOff').dataset.from).toBe('20');
    expect($('#lightsOff').textContent).toBe('20');
    expect($('[data-tpl=sleep] .hint').textContent).toBe('Lights off in 20 s · alarm 06:45 · do not disturb on');
  });

  it('never inserts network text as HTML', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    renderScene({ v: 1, scene: 'research', data: { title: evil, note: { text: evil }, steps: [{ label: evil, state: 'run' }], compare: { title: evil, columns: [evil, evil], rows: [{ label: evil, cells: [{ text: evil }] }] } } }, document, hooks);
    renderScene({ v: 1, scene: 'briefing', data: { agenda: [{ time: '1', title: evil }], room: evil } }, document, hooks);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelectorAll('script')).toHaveLength(0);
    expect($('#rtitle').textContent).toBe(evil);
  });
});

describe('missing fields fall back to the template defaults', () => {
  for (const scene of SCENES) {
    it(`${scene}: bare scene restores exactly what the template shipped with`, () => {
      const before = sectionsHtml();
      renderScene(example(scene), document, hooks);
      expect(sectionsHtml()[scene], 'example data should change something').not.toBe(before[scene]);
      renderScene(bare(scene), document, hooks);
      expect(sectionsHtml()).toEqual(before);
    });
  }
  it('partial data only changes the fields given', () => {
    const before = $('[data-p=stat] > .t').textContent;
    renderScene({ v: 1, scene: 'research', data: { title: 'Only a title' } }, document, hooks);
    expect($('#rtitle').textContent).toBe('Only a title');
    expect($('[data-p=stat] > .t').textContent).toBe(before);
    expect(document.querySelectorAll('#steps li')).toHaveLength(5);
    expect(hooks.setLog).toHaveBeenLastCalledWith(null);
  });
  it('a second scene with fewer fields resets what the first one set', () => {
    renderScene(example('research'), document, hooks);
    renderScene({ v: 1, scene: 'research', data: { title: 'Second' } }, document, hooks);
    expect($('#rtitle').textContent).toBe('Second');
    expect($('#srcCount').dataset.to).toBe('12');
    expect($('[data-p=compare] .hd [data-scr]').textContent).toBe('compare // NDIR vs MOX');
    expect($('[data-p=compare] .hd [data-scr]').dataset.final).toBeUndefined();
  });
});
