/**
 * Speech to text for the dashboard's push-to-talk (M5, brief 0008 V4–V7). The browser records at most 15 s, posts the
 * audio to `/voice/stt` (nginx forwards it here), and gets the words back; it then sends them as a typed command.
 * The key never leaves the brain. Each transcription counts against STT_MAX_MIN_DAY and the daily AI budget.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { handleApi } from './api';
import type { ApiDeps } from './api';
import type { Config, SttConfig } from './config';
import { dayOf } from './store';
import type { Store } from './store';
import type { FrameCache } from './vision';

export const MAX_AUDIO_BYTES = 1024 * 1024;
const MAX_SECONDS = 15;

/** What the dashboard turns into one sentence in the chat. */
export type SttError = 'off' | 'too_big' | 'not_audio' | 'budget' | 'minutes' | 'offline' | 'provider';

export class SttFailed extends Error {
  constructor(
    readonly code: SttError,
    message: string,
  ) {
    super(message);
  }
}

/** One call to `/audio/transcriptions`. `verbose_json` returns the audio length, which is what gets counted. */
export async function transcribe(c: SttConfig, audio: Uint8Array<ArrayBuffer>, mime: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<{ text: string; seconds: number }> {
  const form = new FormData();
  const ext = /ogg/.test(mime) ? 'ogg' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : 'webm';
  form.append('file', new Blob([audio], { type: mime }), `speech.${ext}`);
  form.append('model', c.model);
  form.append('response_format', 'verbose_json');
  if (c.prompt) form.append('prompt', c.prompt);
  if (c.language) form.append('language', c.language);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${c.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    throw new SttFailed('offline', `${c.provider}: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200).replaceAll(c.apiKey, '***');
    throw new SttFailed('provider', `${c.provider}: HTTP ${res.status} ${body}`);
  }
  const data = (await res.json().catch(() => null)) as { text?: string; duration?: number } | null;
  if (typeof data?.text !== 'string') throw new SttFailed('provider', `${c.provider}: response without text`);
  // shortcut: no duration in the reply counts the longest recording; some providers also bill a minimum per request
  const seconds = typeof data.duration === 'number' && data.duration >= 0 ? data.duration : MAX_SECONDS;
  return { text: cleanTranscript(data.text, c.prompt), seconds };
}

/**
 * Whisper invents text on noise or silence: video outros it learned from YouTube subtitles, the prompt read back, one
 * word repeated. Groq scores those like real speech (no_speech_prob 0), so they are recognised by their shape. What is
 * left is what was said; '' when nothing was. Better to ask again than to act on a sentence nobody said.
 */
const HALLUCINATIONS = [
  'cảm ơn các bạn đã theo dõi',
  'cám ơn các bạn đã theo dõi',
  'hẹn gặp lại các bạn',
  'để không bỏ lỡ những video',
  'đăng ký kênh',
  'subscribe cho kênh',
  'ghiền mì gõ',
  'la la school',
  'thanks for watching',
  'thank you for watching',
  'subtitles by',
  'please subscribe',
];
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function cleanTranscript(text: string, prompt = ''): string {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/).filter((s) => {
    const n = norm(s);
    if (!n || HALLUCINATIONS.some((h) => n.includes(h))) return false;
    const words = n.split(' ');
    // "nguồn, nguồn, nguồn, nguồn": the same word four times in a row
    return !words.some((w, i) => i >= 3 && w === words[i - 1] && w === words[i - 2] && w === words[i - 3]);
  });
  const out = sentences.join(' ').trim();
  // the prompt read back in pieces ("Lịch hôm nay, phòng ngủ."): two or more fragments, every one taken from the prompt
  const p = norm(prompt);
  const parts = out.split(/[,.;!?…]/).map(norm).filter(Boolean);
  if (p && parts.length >= 2 && parts.every((f) => p.includes(f))) return '';
  return out;
}

export interface VoiceDeps {
  config: Config;
  store: Store;
  log: (msg: string) => void;
  /** Called after a transcription was counted, so the screen's AI budget moves. */
  onSpent(): void;
  /** The photo the Vision screen shows (M7), served at /vision/frame/<id>. */
  frames?: FrameCache;
  /** The Console API (M8) at /api/*. */
  api?: ApiDeps;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

/** Checks the caps, transcribes, records the cost. Throws SttFailed with the reason the dashboard shows. */
export async function speechToText(d: VoiceDeps, audio: Uint8Array<ArrayBuffer>, mime: string): Promise<string> {
  const { config, store } = d;
  const c = config.stt;
  if (!c) throw new SttFailed('off', 'no STT_API_KEY');
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new SttFailed('too_big', `${audio.byteLength} bytes`);
  if (!/^audio\//.test(mime) || !audio.byteLength) throw new SttFailed('not_audio', mime || 'no content-type');
  const now = d.now ?? Date.now;
  const day = dayOf(now());
  if (store.spentUsd(day) >= config.budgetUsdDay) throw new SttFailed('budget', `daily AI budget of $${config.budgetUsdDay} reached`);
  if (store.sttSecondsOn(day) >= c.maxMinDay * 60) throw new SttFailed('minutes', `${c.maxMinDay} min of speech today reached`);
  const r = await transcribe(c, audio, mime, { ...(d.fetchImpl && { fetchImpl: d.fetchImpl }) });
  store.logStt(now(), c.provider, c.model, r.seconds, (r.seconds / 3600) * c.usdPerHour);
  d.onSpent();
  return r.text;
}

const STATUS: Record<SttError, number> = { off: 503, too_big: 413, not_audio: 415, budget: 429, minutes: 429, offline: 502, provider: 502 };

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Reads the body, refusing more than `max` bytes without buffering it all. */
function readBody(req: IncomingMessage, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/**
 * `GET /voice/stt` → `{ on }` (does the brain transcribe?) · `POST /voice/stt` (audio body) → `{ text }` or `{ error }` ·
 * `GET /vision/frame/<id>` → the photo just taken (M7), from memory, 404 once gone · `/api/*` → the Console (M8, api.ts).
 * Nothing else. Reachable only through vega-ui's nginx on the Pi (no host port) or on 127.0.0.1 in dev.
 */
export function voiceServer(d: VoiceDeps): Server {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]!;
    if (path.startsWith('/api/')) return d.api ? handleApi(req, res, d.api) : json(res, 404, { error: 'not found' });
    const frame = /^\/vision\/frame\/([A-Za-z0-9_-]{8,64})$/.exec(path);
    if (frame && req.method === 'GET') {
      const jpeg = d.frames?.get(frame[1]!);
      if (!jpeg) return json(res, 404, { error: 'gone' });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpeg.length, 'cache-control': 'no-store' });
      return void res.end(jpeg);
    }
    if (path !== '/voice/stt') return json(res, 404, { error: 'not found' });
    if (req.method === 'GET') return json(res, 200, { on: !!d.config.stt });
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (Number(req.headers['content-length'] ?? 0) > MAX_AUDIO_BYTES) return json(res, 413, { error: 'too_big' });
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    void readBody(req, MAX_AUDIO_BYTES)
      .then(async (audio) => {
        if (!audio) return json(res, 413, { error: 'too_big' });
        try {
          json(res, 200, { text: await speechToText(d, audio, mime) });
        } catch (e) {
          if (!(e instanceof SttFailed)) throw e;
          d.log(`[voice] speech to text refused (${e.code}): ${e.message}`);
          json(res, STATUS[e.code], { error: e.code });
        }
      })
      .catch((e: unknown) => {
        d.log(`[voice] speech to text failed: ${(e as Error).message}`);
        if (!res.headersSent) json(res, 500, { error: 'provider' });
      });
  });
}
