import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORD_MS, MIC_TEXT, PushToTalk, micProblemOf, sttAvailable } from '../src/ui/ptt';
import type { MicEnv, MicProblem, PttState } from '../src/ui/ptt';

/** A MediaRecorder stand-in: stop() delivers one chunk of "audio", then onstop. */
class FakeRecorder {
  static last: FakeRecorder | null = null;
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  started = false;
  constructor(readonly stream: MediaStream) {
    FakeRecorder.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function setup(opts: { secure?: boolean; mic?: () => Promise<MediaStream>; reply?: () => Response | Promise<Response>; noRecorder?: boolean } = {}) {
  const stopped: string[] = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push('track') }] } as unknown as MediaStream;
  const posts: { url: string; type: string; size: number }[] = [];
  const env: MicEnv = {
    isSecureContext: opts.secure ?? true,
    getUserMedia: opts.mic ?? (() => Promise.resolve(stream)),
    ...(!opts.noRecorder && { MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder }),
    fetch: (async (url: string, init: RequestInit) => {
      posts.push({ url, type: new Headers(init.headers).get('content-type')!, size: (init.body as Blob).size });
      return opts.reply ? opts.reply() : Response.json({ text: ' phòng mấy độ ' });
    }) as unknown as typeof fetch,
  };
  const states: PttState[] = [];
  const texts: string[] = [];
  const problems: MicProblem[] = [];
  const ptt = new PushToTalk(env, { onState: (s) => states.push(s), onText: (t) => texts.push(t), onProblem: (p) => problems.push(p) });
  const settled = () => vi.waitFor(() => expect(ptt.state).toBe('idle'));
  return { ptt, states, texts, problems, posts, stopped, settled };
}

afterEach(() => vi.useRealTimers());

describe('push-to-talk', () => {
  it('records, posts the audio to /voice/stt, hands back the words', async () => {
    const t = setup();
    await t.ptt.start();
    expect(t.ptt.state).toBe('recording');
    t.ptt.stop();
    await t.settled();
    expect(t.posts).toEqual([{ url: '/voice/stt', type: 'audio/webm', size: 3 }]);
    expect(t.texts).toEqual(['phòng mấy độ']);
    expect(t.states).toEqual(['starting', 'recording', 'sending', 'idle']);
    expect(t.stopped).toEqual(['track']); // the mic is released
  });

  it('stops by itself after 15 seconds', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.ptt.start();
    vi.advanceTimersByTime(MAX_RECORD_MS);
    vi.useRealTimers();
    await t.settled();
    expect(t.posts).toHaveLength(1);
  });

  it('released while the browser still asks for permission: nothing is sent, the mic is released', async () => {
    let grant!: (s: MediaStream) => void;
    const t = setup({ mic: () => new Promise((r) => (grant = r)) });
    const p = t.ptt.start();
    t.ptt.stop();
    grant({ getTracks: () => [{ stop: () => t.stopped.push('track') }] } as unknown as MediaStream);
    await p;
    expect(t.ptt.state).toBe('idle');
    expect(t.posts).toEqual([]);
    expect(t.stopped).toEqual(['track']);
  });

  it('every problem ends in one sentence, never silence', async () => {
    const problem = async (o: Parameters<typeof setup>[0]) => {
      const t = setup(o);
      await t.ptt.start();
      if (t.ptt.state === 'recording') t.ptt.stop();
      await t.settled();
      return t.problems;
    };
    const err = (name: string) => () => Promise.reject(Object.assign(new Error(name), { name }));
    expect(await problem({ secure: false })).toEqual(['insecure']);
    expect(await problem({ noRecorder: true })).toEqual(['unsupported']);
    expect(await problem({ mic: err('NotAllowedError') })).toEqual(['denied']);
    expect(await problem({ mic: err('NotFoundError') })).toEqual(['no_mic']);
    expect(await problem({ mic: err('NotReadableError') })).toEqual(['busy']);
    expect(await problem({ reply: () => Response.json({ error: 'budget' }, { status: 429 }) })).toEqual(['budget']);
    expect(await problem({ reply: () => Response.json({ error: 'minutes' }, { status: 429 }) })).toEqual(['minutes']);
    expect(await problem({ reply: () => Response.json({ error: 'off' }, { status: 503 }) })).toEqual(['off']);
    expect(await problem({ reply: () => Response.json({ error: 'offline' }, { status: 502 }) })).toEqual(['offline']);
    expect(await problem({ reply: () => new Response('<html>', { status: 404 }) })).toEqual(['off']);
    expect(await problem({ reply: () => new Response('Bad Gateway', { status: 502 }) })).toEqual(['provider']);
    expect(await problem({ reply: () => Promise.reject(new TypeError('Failed to fetch')) })).toEqual(['offline']);
    expect(await problem({ reply: () => Response.json({ text: '  ' }) })).toEqual(['empty']);
    for (const p of Object.keys(MIC_TEXT) as MicProblem[]) expect(MIC_TEXT[p].length).toBeGreaterThan(10);
  });

  it('getUserMedia error names', () => {
    expect(micProblemOf({ name: 'SecurityError' })).toBe('denied');
    expect(micProblemOf({ name: 'OverconstrainedError' })).toBe('no_mic');
    expect(micProblemOf(null)).toBe('failed');
  });

  it('asks the brain whether it transcribes; a static host or an error means no', async () => {
    const reply = (r: Response | Error) => (() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r))) as unknown as typeof fetch;
    expect(await sttAvailable(reply(Response.json({ on: true })))).toBe(true);
    expect(await sttAvailable(reply(Response.json({ on: false })))).toBe(false);
    expect(await sttAvailable(reply(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })))).toBe(false);
    expect(await sttAvailable(reply(new TypeError('Failed to fetch')))).toBe(false);
  });
});
