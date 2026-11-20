/**
 * Push-to-talk (M5, brief 0008 V5–V7): record at most 15 s with MediaRecorder, post it to `/voice/stt` on the page's
 * own address (the brain transcribes it, the key stays there), hand back the words. Every way it can fail ends in one
 * sentence for the chat: VEGA never goes silent.
 */
export const MAX_RECORD_MS = 15_000;

export type MicProblem = 'insecure' | 'unsupported' | 'denied' | 'no_mic' | 'busy' | 'off' | 'too_big' | 'not_audio' | 'budget' | 'minutes' | 'offline' | 'provider' | 'empty' | 'failed';

export const MIC_TEXT: Record<MicProblem, string> = {
  insecure: 'The microphone only works on an HTTPS page (or localhost). Open VEGA at its https://…ts.net address (README, M5).',
  unsupported: 'This browser cannot record audio. Type instead, or use a recent Chrome, Edge, Firefox or Safari.',
  denied: 'Microphone blocked: allow it for this page in the browser, then hold the mic again.',
  no_mic: 'No microphone found. Plug one in (or switch it on), then hold the mic again.',
  busy: 'The microphone is in use by another app, or was just unplugged.',
  off: 'Voice input is off: the brain has no STT_API_KEY (README, M5). Typing still works.',
  too_big: 'That recording was too long. Hold the mic for 15 seconds at most.',
  not_audio: 'The recording could not be read. Try again.',
  budget: 'Daily AI budget reached: voice input is paused until tomorrow. Typing still works.',
  minutes: 'Today’s minutes of voice input are used up. Typing still works.',
  offline: 'Voice input needs the internet, and it is not reachable right now. Typing still works.',
  provider: 'The speech service did not answer. Try again in a moment, or type.',
  empty: 'I did not catch that. Hold the mic while you speak.',
  failed: 'Voice input failed. Try again, or type.',
};

const SERVER_CODES = new Set<MicProblem>(['off', 'too_big', 'not_audio', 'budget', 'minutes', 'offline', 'provider']);

/** What the browser gives a page; injected so the tests need no real microphone. */
export interface MicEnv {
  isSecureContext: boolean;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: typeof MediaRecorder;
  fetch: typeof fetch;
}

export function browserMicEnv(): MicEnv {
  const md = navigator.mediaDevices;
  return {
    isSecureContext: window.isSecureContext,
    ...(md?.getUserMedia && { getUserMedia: (c: MediaStreamConstraints) => md.getUserMedia(c) }),
    ...(typeof MediaRecorder !== 'undefined' && { MediaRecorder }),
    fetch: (...a) => fetch(...a),
  };
}

/** getUserMedia error name → problem. */
export function micProblemOf(e: unknown): MicProblem {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_mic';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'failed';
}

/** Does the brain transcribe? `GET /voice/stt` → `{ on }`. Anything else (no brain behind the page, a static host) is no. */
export async function sttAvailable(f: typeof fetch): Promise<boolean> {
  try {
    const r = await f('/voice/stt', { cache: 'no-store' });
    if (!r.ok || !/json/.test(r.headers.get('content-type') ?? '')) return false;
    return ((await r.json()) as { on?: unknown }).on === true;
  } catch {
    return false;
  }
}

export type PttState = 'idle' | 'starting' | 'recording' | 'sending';

export interface PttHandlers {
  onState(s: PttState): void;
  onText(text: string): void;
  onProblem(p: MicProblem): void;
}

export class PushToTalk {
  private s: PttState = 'idle';
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  constructor(
    private readonly env: MicEnv,
    private readonly h: PttHandlers,
  ) {}

  get state(): PttState {
    return this.s;
  }

  private set(s: PttState): void {
    this.s = s;
    this.h.onState(s);
  }

  /** Opens the mic and records until stop() or 15 s. */
  async start(): Promise<void> {
    if (this.s !== 'idle') return;
    const { env } = this;
    if (!env.isSecureContext) return this.h.onProblem('insecure');
    if (!env.getUserMedia || !env.MediaRecorder) return this.h.onProblem('unsupported');
    this.cancelled = false;
    this.set('starting');
    let stream: MediaStream;
    try {
      stream = await env.getUserMedia({ audio: true });
    } catch (e) {
      this.set('idle');
      return this.h.onProblem(micProblemOf(e));
    }
    if (this.cancelled) {
      // released while the browser was still asking for permission: nothing was said
      for (const t of stream.getTracks()) t.stop();
      return this.set('idle');
    }
    this.stream = stream;
    const chunks: Blob[] = [];
    const rec = new env.MediaRecorder(stream);
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      this.stream = null;
      this.rec = null;
      void this.send(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    this.rec = rec;
    rec.start();
    this.set('recording');
    this.timer = setTimeout(() => this.stop(), MAX_RECORD_MS);
  }

  /** Stops recording and sends what was heard. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.s === 'starting') this.cancelled = true;
    else if (this.s === 'recording' && this.rec) {
      this.set('sending');
      this.rec.stop();
    }
  }

  private async send(audio: Blob): Promise<void> {
    if (this.s !== 'sending') this.set('sending');
    try {
      if (!audio.size) return this.h.onProblem('empty');
      let r: Response;
      try {
        r = await this.env.fetch('/voice/stt', { method: 'POST', headers: { 'content-type': audio.type.split(';')[0] || 'audio/webm' }, body: audio });
      } catch {
        return this.h.onProblem('offline'); // the page's own host did not answer
      }
      const body = (await r.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
      if (r.ok && typeof body?.text === 'string') return body.text.trim() ? this.h.onText(body.text.trim()) : this.h.onProblem('empty');
      const code = body?.error as MicProblem;
      // no JSON: 404 = nothing serves /voice/stt here; 502 and the like = nginx could not reach the brain
      this.h.onProblem(SERVER_CODES.has(code) ? code : r.status === 404 ? 'off' : 'provider');
    } finally {
      this.set('idle');
    }
  }
}
