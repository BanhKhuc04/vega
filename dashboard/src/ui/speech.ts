/**
 * Reading answers aloud: Piper on the Pi (`/voice/tts`, M5) when the page is served by it, else the browser's voices
 * (Vietnamese if the machine has one). Listening here is the browser's own recognition (Chrome/Edge, audio sent to
 * Google/Microsoft): the fallback when the brain has no speech to text; push-to-talk to the brain is in ptt.ts.
 */
const VI = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;
const KEY = 'vega.speak';

/** `vi-VN` for text with Vietnamese letters, `en-US` otherwise. */
export const langOf = (text: string): string => (VI.test(text) ? 'vi-VN' : 'en-US');

/** The installed voice that best matches the language, or null (the browser then picks one for `lang`). */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null;
}

interface RecResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<RecResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;
export interface SpeechWindow {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
  localStorage?: Storage;
  /** For Piper on the Pi (`/voice/tts`, M5). */
  fetch?: typeof fetch;
  Audio?: new (src?: string) => HTMLAudioElement;
  URL?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

/** Longest text sent to `/voice/tts` (vega-voice refuses more). */
const TTS_MAX = 500;

export interface ListenHandlers {
  onText(text: string, final: boolean): void;
  onError(error: string): void;
  onEnd(): void;
}

export class Voice {
  readonly canSpeak: boolean;
  readonly canListen: boolean;
  private rec: Recognition | null = null;
  private on: boolean;
  /** Piper behind `/voice/tts`: unknown until first tried, off for the rest of the visit once it fails. */
  private tts: 'unknown' | 'on' | 'off';
  private audio: HTMLAudioElement | null = null;
  /** Bumped by every speak/stop, so a slow answer from Piper never talks over a newer one. */
  private seq = 0;

  constructor(private readonly win: SpeechWindow = window as unknown as SpeechWindow) {
    this.tts = win.fetch && win.Audio && win.URL ? 'unknown' : 'off';
    this.canSpeak = !!(win.speechSynthesis && win.SpeechSynthesisUtterance) || this.tts !== 'off';
    this.canListen = !!(win.SpeechRecognition ?? win.webkitSpeechRecognition);
    let stored: string | null = null;
    try {
      stored = win.localStorage?.getItem(KEY) ?? null;
    } catch {
      // storage blocked: default on
    }
    this.on = stored !== '0';
  }

  /** Whether answers are read aloud (the speaker button). */
  get enabled(): boolean {
    return this.canSpeak && this.on;
  }
  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.stop();
    try {
      this.win.localStorage?.setItem(KEY, on ? '1' : '0');
    } catch {
      // not remembered, still applies now
    }
  }

  /** Stops whatever is being read. */
  stop(): void {
    this.seq++;
    this.audio?.pause();
    this.audio = null;
    this.win.speechSynthesis?.cancel();
  }

  /**
   * Reads `text` aloud, cutting off whatever was being read: with Piper on the Pi when it is there (the same Vietnamese
   * voice on every device), otherwise with the browser's voices. Resolves false when neither has a voice for the
   * language: an English voice reading Vietnamese is noise, so it stays silent instead.
   */
  async speak(text: string): Promise<boolean> {
    if (!this.enabled || !text.trim()) return true;
    this.stop();
    const seq = this.seq;
    if (this.tts !== 'off' && (await this.piper(text.slice(0, TTS_MAX), seq))) return true;
    if (seq !== this.seq) return true; // something newer took over while Piper was asked
    return this.browserSpeak(text);
  }

  /** Plays Piper's WAV. False when there is no vega-voice behind the page (dev server, static host, container down). */
  private async piper(text: string, seq: number): Promise<boolean> {
    const { Audio: A, URL: U } = this.win;
    let blob: Blob;
    try {
      const r = await this.win.fetch!(`/voice/tts?text=${encodeURIComponent(text)}&lang=${langOf(text).slice(0, 2)}`);
      // a dev server answers unknown paths with index.html: only audio counts
      if (!r.ok || !/^audio\//.test(r.headers.get('content-type') ?? '')) throw new Error(`HTTP ${r.status}`);
      blob = await r.blob();
    } catch {
      // shortcut: one failure turns Piper off until the page is reloaded (a restarting container is not retried)
      this.tts = 'off';
      return false;
    }
    this.tts = 'on';
    if (seq !== this.seq) return true;
    const url = U!.createObjectURL(blob);
    const a = new A!(url);
    a.onended = a.onerror = () => U!.revokeObjectURL(url);
    this.audio = a;
    // autoplay blocked (nobody touched the page yet): nothing else would be allowed to speak either
    await a.play().catch(() => {});
    return true;
  }

  private browserSpeak(text: string): boolean {
    const { speechSynthesis: synth, SpeechSynthesisUtterance: Utter } = this.win;
    if (!synth || !Utter) return true;
    const lang = langOf(text);
    const voices = synth.getVoices();
    const voice = pickVoice(voices, lang);
    if (!voice && voices.length > 0) return false; // an empty list means voices are still loading: let the browser pick
    const u = new Utter(text);
    u.lang = lang;
    if (voice) u.voice = voice;
    synth.speak(u);
    return true;
  }

  get listening(): boolean {
    return this.rec !== null;
  }

  /** Starts listening (Vietnamese). Stops reading first, so the mic does not hear the speaker. */
  listen(h: ListenHandlers): boolean {
    const Ctor = this.win.SpeechRecognition ?? this.win.webkitSpeechRecognition;
    if (!Ctor || this.rec) return false;
    this.stop();
    const rec = new Ctor();
    rec.lang = 'vi-VN';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const results = Array.from(e.results);
      h.onText(results.map((r) => r[0].transcript).join(''), results.at(-1)?.isFinal ?? false);
    };
    rec.onerror = (e) => h.onError(e.error);
    rec.onend = () => {
      this.rec = null;
      h.onEnd();
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (e) {
      this.rec = null;
      h.onError((e as Error).message);
      return false;
    }
    return true;
  }

  stopListening(): void {
    this.rec?.stop();
  }
}
