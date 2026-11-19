/**
 * Voice in the browser (Web Speech API): read answers aloud, and listen to the owner.
 * Listening only exists in Chrome/Edge and sends the audio to Google/Microsoft for recognition; elsewhere the mic is off
 * and typing still works. Reading uses the voices installed on the machine (Vietnamese if there is one).
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
}

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

  constructor(private readonly win: SpeechWindow = window as unknown as SpeechWindow) {
    this.canSpeak = !!(win.speechSynthesis && win.SpeechSynthesisUtterance);
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
    if (!on) this.win.speechSynthesis?.cancel();
    try {
      this.win.localStorage?.setItem(KEY, on ? '1' : '0');
    } catch {
      // not remembered, still applies now
    }
  }

  /**
   * Reads `text` aloud, cutting off whatever was being read. Returns false when the machine has no voice for its
   * language: an English voice reading Vietnamese is noise, so it stays silent instead.
   */
  speak(text: string): boolean {
    const { speechSynthesis: synth, SpeechSynthesisUtterance: Utter } = this.win;
    if (!this.enabled || !synth || !Utter || !text.trim()) return true;
    const lang = langOf(text);
    const voices = synth.getVoices();
    const voice = pickVoice(voices, lang);
    if (!voice && voices.length > 0) return false; // an empty list means voices are still loading: let the browser pick
    synth.cancel();
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
    this.win.speechSynthesis?.cancel();
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
