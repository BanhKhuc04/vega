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
  it('reads answers aloud with a matching voice, cutting off the previous one', async () => {
    const f = fakeWindow({ voices: [{ lang: 'vi-VN', name: 'An' }] });
    const v = new Voice(f.win);
    expect(v.enabled).toBe(true);
    await v.speak('Xin chào!');
    expect(f.spoken[0]).toMatchObject({ text: 'Xin chào!', lang: 'vi-VN', voice: { name: 'An' } });
    expect(f.cancels()).toBe(1);
    await v.speak('   ');
    expect(f.spoken).toHaveLength(1);
  });

  it('stays silent (and says so) when no installed voice speaks the language', async () => {
    const f = fakeWindow({ voices: [{ lang: 'en-US', name: 'Zira' }] });
    const v = new Voice(f.win);
    expect(await v.speak('Xin chào! Tôi có thể giúp gì?')).toBe(false);
    expect(f.spoken).toEqual([]);
    expect(await v.speak('Bedroom 25.0°C')).toBe(true);
    expect(f.spoken[0]).toMatchObject({ lang: 'en-US', voice: { name: 'Zira' } });
    expect(await new Voice(fakeWindow({ voices: [] }).win).speak('Xin chào')).toBe(true); // voices not loaded yet: try anyway
  });

  it('the speaker button turns reading off and is remembered', async () => {
    const f = fakeWindow();
    const v = new Voice(f.win);
    v.setEnabled(false);
    await v.speak('Xin chào!');
    expect(f.spoken).toEqual([]);
    expect(f.store.get('vega.speak')).toBe('0');
    expect(new Voice(f.win).enabled).toBe(false);
    expect(new Voice(fakeWindow({ storageThrows: true }).win).enabled).toBe(true); // storage blocked: still works
  });

  it('without speech support nothing breaks', async () => {
    const v = new Voice({} as SpeechWindow);
    expect(v.canSpeak).toBe(false);
    expect(v.canListen).toBe(false);
    expect(await v.speak('hi')).toBe(true);
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

  describe('Piper on the Pi (/voice/tts)', () => {
    function piperWindow(reply: (url: string) => Response | Promise<Response>, voices = [{ lang: 'en-US', name: 'Zira' }]) {
      const f = fakeWindow({ voices });
      const asked: string[] = [];
      const played: string[] = [];
      const paused: string[] = [];
      class FakeAudio {
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(readonly src: string) {}
        play() {
          played.push(this.src);
          return Promise.resolve();
        }
        pause() {
          paused.push(this.src);
        }
      }
      let n = 0;
      Object.assign(f.win, {
        fetch: (url: string) => (asked.push(url), Promise.resolve(reply(url))),
        Audio: FakeAudio,
        URL: { createObjectURL: () => `blob:${++n}`, revokeObjectURL() {} },
      });
      return { ...f, asked, played, paused };
    }
    const wav = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } });

    it('reads Vietnamese with Piper even when the machine has no Vietnamese voice; the browser stays quiet', async () => {
      const f = piperWindow(wav);
      const v = new Voice(f.win);
      expect(v.canSpeak).toBe(true);
      expect(await v.speak('Phòng ngủ 25 độ.')).toBe(true);
      expect(f.asked).toEqual([`/voice/tts?text=${encodeURIComponent('Phòng ngủ 25 độ.')}&lang=vi`]);
      expect(f.played).toEqual(['blob:1']);
      expect(f.spoken).toEqual([]);
      await v.speak('Bedroom 25 degrees');
      expect(f.asked[1]).toMatch(/&lang=en$/);
      expect(f.paused).toEqual(['blob:1']); // the newer answer cut the older one off
    });

    it('no vega-voice behind the page (index.html from a dev server, or 502): browser voice, Piper not asked again', async () => {
      const f = piperWindow(() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
      const v = new Voice(f.win);
      expect(await v.speak('Bedroom 25 degrees')).toBe(true);
      expect(f.spoken).toHaveLength(1);
      await v.speak('Bedroom 26 degrees');
      expect(f.asked).toHaveLength(1);
      const g = piperWindow(() => new Response('', { status: 502 }), []);
      expect(await new Voice(g.win).speak('hi')).toBe(true);
    });

    it('text over 500 characters is cut before it is sent', async () => {
      const f = piperWindow(wav);
      await new Voice(f.win).speak('a'.repeat(800));
      expect(decodeURIComponent(f.asked[0]!.split('text=')[1]!.split('&')[0]!)).toHaveLength(500);
    });

    it('a slow answer from Piper does not play after reading was turned off', async () => {
      let release!: (r: Response) => void;
      const f = piperWindow(() => new Promise<Response>((r) => (release = r)));
      const v = new Voice(f.win);
      const p = v.speak('Xin chào');
      v.setEnabled(false);
      release(wav());
      await p;
      expect(f.played).toEqual([]);
    });
  });
});
