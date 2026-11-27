import { describe, expect, it } from 'vitest';
import { parseScene } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { ACTIONS, PAGES, initialNav, inVi, keyOf, pageView, promptOf, sceneText, step } from '../src/mini/nav';
import type { Key, NavState } from '../src/mini/nav';
import { MockSource } from '../src/data/mock-source';

const scene = (o: Record<string, unknown>): SceneMessage => {
  const r = parseScene({ v: 1, ...o });
  if (!r.ok) throw new Error(r.error);
  return r.scene;
};

const run = (keys: Key[], s: NavState = initialNav()) => {
  const sent: string[] = [];
  for (const k of keys) {
    const r = step(s, k);
    s = r.state;
    if (r.send) sent.push(r.send);
  }
  return { s, sent };
};

describe('mini screen knob', () => {
  it('maps keys from the knob service and a keyboard', () => {
    expect(['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'a'].map(keyOf)).toEqual(['down', 'up', 'enter', 'back', null]);
  });

  it('turning cycles the pages both ways and long press goes home', () => {
    expect(run(['down']).s.page).toBe(1);
    expect(run(['up']).s.page).toBe(PAGES.length - 1);
    expect(run(['down', 'down', 'back']).s.page).toBe(0);
  });

  it('opens the quick commands, picks one and sends it', () => {
    const toActions: Key[] = ['up']; // actions is the last page
    const { s, sent } = run([...toActions, 'enter', 'down', 'enter']);
    expect(sent).toEqual([ACTIONS[1]!.command]);
    expect(s.inList).toBe(false);
    expect(run([...toActions, 'enter', 'up', 'back']).sent).toEqual([]); // long press leaves without sending
  });

  it('enter on a page without commands does nothing', () => {
    expect(run(['enter'])).toEqual({ s: initialNav(), sent: [] });
  });

  it('a confirmation from the brain takes the knob, defaults to cancel', () => {
    const q = promptOf(scene({ scene: 'alert', data: { title: 'Tắt PC?', confirm: true } }))!;
    expect(q.choices.map((c) => c.command)).toEqual(['no', 'yes']);
    const start = { ...initialNav(), prompt: q };
    expect(run(['enter'], start).sent).toEqual(['no']);
    expect(run(['down', 'enter'], start).sent).toEqual(['yes']);
    expect(run(['back'], start)).toMatchObject({ sent: [], s: { prompt: null } });
  });

  it('a reminder offers snooze; plain alerts and other scenes ask nothing', () => {
    expect(promptOf(scene({ scene: 'alert', data: { title: 'Uống nước', snooze: true } }))!.choices[1]!.command).toBe('snooze');
    expect(promptOf(scene({ scene: 'alert', data: { title: 'CI failed' } }))).toBeNull();
    expect(promptOf(scene({ scene: 'success', data: { title: 'Xong' } }))).toBeNull();
  });

  it('scene text falls back when data is missing', () => {
    expect(sceneText(scene({ scene: 'listen', data: { transcript: 'bật đèn' } }))).toEqual({ label: 'Đang nghe', line: 'bật đèn' });
    expect(sceneText(scene({ scene: 'think' })).line).toBe('');
  });

  it('pages render from a snapshot', () => {
    const snap = new MockSource().getSnapshot();
    const now = Date.now();
    for (const p of PAGES) expect(pageView(p, snap, now).title).toBeTruthy();
    expect(pageView('next', { ...snap, next: null }, now).big).toBe('Trống');
    expect(inVi(0)).toBe('bây giờ');
    expect(inVi(125 * 60_000)).toBe('2 giờ 05 phút nữa');
  });
});
