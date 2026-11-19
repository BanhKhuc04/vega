// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '../src/ui/chat';

describe('Chat', () => {
  let root: HTMLElement;
  let input: HTMLInputElement;
  let next: string | null;
  const lines = () => [...root.querySelectorAll('.msg')].map((p) => `${p.className} | ${p.textContent}`);

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<section id="chat"></section><input id="q">';
    root = document.getElementById('chat')!;
    input = document.getElementById('q') as HTMLInputElement;
    next = 'UI-1';
  });
  afterEach(() => vi.useRealTimers());
  const make = (o: { maxLines?: number } = {}) => new Chat({ root, input, send: () => next, timeoutMs: 30_000, ...o });

  it('is hidden until something is said; pairs the answer with its command', () => {
    const c = make();
    expect(root.hidden).toBe(true);
    expect(c.submit('  xin chào ')).toBe('UI-1');
    expect(root.hidden).toBe(false);
    expect(lines()).toEqual(['msg you wait | Youxin chào']);
    expect(c.result('UI-1', 'Xin chào! Tôi có thể giúp gì?')).toBe(true);
    expect(lines()).toEqual(['msg you | Youxin chào', 'msg vega | VEGAXin chào! Tôi có thể giúp gì?']);
  });

  it('cited sources become links that open in a new tab; text stays text', () => {
    const c = make();
    c.submit('nghiên cứu cảm biến CO2');
    c.result('UI-1', 'SCD40 [1], S8 [2].', [
      { n: 1, title: 'SCD40 <b>vs</b> MH-Z19B', url: 'https://www.sensors.example.com/co2' },
      { n: 2, title: 'S8 review', url: 'https://homelab.example.org/s8' },
    ]);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.msg.vega .src a')];
    expect(links.map((a) => [a.textContent, a.href, a.target, a.rel])).toEqual([
      ['[1] SCD40 <b>vs</b> MH-Z19B', 'https://www.sensors.example.com/co2', '_blank', 'noopener noreferrer'],
      ['[2] S8 review', 'https://homelab.example.org/s8', '_blank', 'noopener noreferrer'],
    ]);
    expect(root.querySelector('.src b')).toBeNull(); // the title is text, not markup
    expect([...root.querySelectorAll('.src small')].map((s) => s.textContent)).toEqual([' · sensors.example.com', ' · homelab.example.org']);
  });

  it('ignores answers it did not ask for (another tab, an old retained one)', () => {
    const c = make();
    expect(c.result('UI-other', 'nope')).toBe(false);
    expect(lines()).toEqual([]);
  });

  it('a command that could not be sent says so and goes back into the box', () => {
    const c = make();
    next = null;
    input.value = '';
    expect(c.submit('bật đèn')).toBeNull();
    expect(input.value).toBe('bật đèn');
    expect(lines()).toEqual(['msg you fail | Youbật đèn', 'msg sys | VEGANot sent — not connected. Try again when the header shows LIVE.']);
  });

  it('says when no answer came within 30 s, and still shows a late one', () => {
    const c = make();
    c.submit('phòng mấy độ');
    vi.advanceTimersByTime(30_001);
    expect(lines().at(-1)).toBe('msg sys | VEGANo answer — is the brain running?');
    expect(c.result('UI-1', 'Bedroom 25.0°C')).toBe(true);
    expect(lines().at(-1)).toBe('msg vega | VEGABedroom 25.0°C');
  });

  it('keeps the last lines only, and never renders HTML', () => {
    const c = make({ maxLines: 3 });
    for (let i = 0; i < 4; i++) {
      next = `UI-${i}`;
      c.submit(`<img src=x onerror=alert(${i})>`);
    }
    expect(root.children).toHaveLength(3);
    expect(root.querySelector('img')).toBeNull();
    expect(c.submit('   ')).toBeNull();
  });
});
