import { describe, expect, it } from 'vitest';
import { Voice, langOf, pickVoice } from '../src/ui/speech';
import type { ListenHandlers, SpeechWindow } from '../src/ui/speech';

class FakeUtter {
  lang = '';
  voice: unknown = null;
  constructor(readonly text: string) {}
}
function fakeWindow(opts: { voices?: { lang: string; name: string }[]; listen?: boolean; stored?: string | null; storageThrows?: boolean } = {}) {
  const spoken: FakeUtter[] = [];
  let cancels = 0;
  const store = new Map<string, string>(opts.stored != null ? [['vega.speak', opts.stored]] : []);
  const recs: FakeRec[] = [];
  class FakeRec {
    lang = '';
    interimResults = false;
    continuous = true;
    onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    constructor() {
      recs.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
  }
  const win = {
    speechSynthesis: { speak: (u: FakeUtter) => spoken.push(u), cancel: () => cancels++, getVoices: () => opts.voices ?? [] },
    SpeechSynthesisUtterance: FakeUtter,
    ...(opts.listen && { webkitSpeechRecognition: FakeRec }),
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error('blocked');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.storageThrows) throw new Error('blocked');
        store.set(k, v);
      },
    },
  } as unknown as SpeechWindow;
  return { win, spoken, recs, store, cancels: () => cancels };
}

describe('speech helpers', () => {
  it('picks the language from the text', () => {
    expect(langOf('Xin chào! Tôi có thể giúp gì?')).toBe('vi-VN');
    expect(langOf('Bedroom 25.0°C · Living room light on')).toBe('en-US');
  });
  it('picks an installed voice for the language', () => {
    const voices = [{ lang: 'en-US', name: 'Zira' }, { lang: 'vi-VN', name: 'An' }] as SpeechSynthesisVoice[];
    expect(pickVoice(voices, 'vi-VN')?.name).toBe('An');
    expect(pickVoice([{ lang: 'en-GB', name: 'Hazel' }] as SpeechSynthesisVoice[], 'en-US')?.name).toBe('Hazel');
    expect(pickVoice([], 'vi-VN')).toBeNull();
  });
});

describe('Voice', () => {
  it('reads answers aloud with a matching voice, cutting off the previous one', () => {
    const f = fakeWindow({ voices: [{ lang: 'vi-VN', name: 'An' }] });
    const v = new Voice(f.win);
    expect(v.enabled).toBe(true);
    v.speak('Xin chào!');
    expect(f.spoken[0]).toMatchObject({ text: 'Xin chào!', lang: 'vi-VN', voice: { name: 'An' } });
    expect(f.cancels()).toBe(1);
    v.speak('   ');
    expect(f.spoken).toHaveLength(1);
  });

  it('the speaker button turns reading off and is remembered', () => {
    const f = fakeWindow();
    const v = new Voice(f.win);
    v.setEnabled(false);
    v.speak('Xin chào!');
    expect(f.spoken).toEqual([]);
    expect(f.store.get('vega.speak')).toBe('0');
    expect(new Voice(f.win).enabled).toBe(false);
    expect(new Voice(fakeWindow({ storageThrows: true }).win).enabled).toBe(true); // storage blocked: still works
  });

  it('without speech support nothing breaks', () => {
    const v = new Voice({} as SpeechWindow);
    expect(v.canSpeak).toBe(false);
    expect(v.canListen).toBe(false);
    v.speak('hi');
    expect(v.listen({ onText() {}, onError() {}, onEnd() {} })).toBe(false);
  });

  it('listens in Vietnamese, streams interim text, stops reading first', () => {
    const f = fakeWindow({ listen: true });
    const v = new Voice(f.win);
    expect(v.canListen).toBe(true);
    const got: [string, boolean][] = [];
    let ended = false;
    const h: ListenHandlers = { onText: (t, final) => got.push([t, final]), onError() {}, onEnd: () => (ended = true) };
    expect(v.listen(h)).toBe(true);
    expect(v.listen(h)).toBe(false); // already listening
    const rec = f.recs[0]!;
    expect(rec).toMatchObject({ lang: 'vi-VN', interimResults: true, continuous: false, started: true });
    expect(f.cancels()).toBe(1);
    rec.onresult!({ results: [{ isFinal: false, 0: { transcript: 'phòng mấy' } }] });
    rec.onresult!({ results: [{ isFinal: true, 0: { transcript: 'phòng mấy độ' } }] });
    expect(got).toEqual([['phòng mấy', false], ['phòng mấy độ', true]]);
    v.stopListening();
    expect(ended).toBe(true);
    expect(v.listening).toBe(false);
  });
});
