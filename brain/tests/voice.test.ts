import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { STT_PROMPT, loadConfig } from '../src/config';
import type { Config } from '../src/config';
import { Store, dayOf } from '../src/store';
import { SttFailed, cleanTranscript, speechToText, transcribe, voiceServer } from '../src/voice';

const KEY = 'gsk_secret_stt_key';
const env = { STT_API_KEY: KEY, STT_USD_PER_HOUR: '0.04', BRAIN_DB: ':memory:' };
const audio = new Uint8Array([1, 2, 3, 4]);

/** A stand-in for /audio/transcriptions that records what it got. */
function fakeFetch(reply: { status?: number; body?: unknown } = {}) {
  const seen: { url: string; auth: string | null; form: FormData }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, auth: new Headers(init.headers).get('authorization'), form: init.body as FormData });
    return new Response(JSON.stringify(reply.body ?? { text: ' phòng mấy độ ', duration: 2.5 }), { status: reply.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, seen };
}

function deps(cfg: Config, f: typeof fetch, store = new Store(':memory:')) {
  const logs: string[] = [];
  let spent = 0;
  return { d: { config: cfg, store, log: (m: string) => logs.push(m), onSpent: () => void spent++, fetchImpl: f }, logs, store, spent: () => spent };
}

describe('config', () => {
  it('Groq by default: preset URL and model; off without a key or a price', () => {
    const c = loadConfig(env).stt!;
    expect(c).toMatchObject({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo', usdPerHour: 0.04, maxMinDay: 30 });
    expect(loadConfig({}).stt).toBeNull();
    const noPrice = loadConfig({ STT_API_KEY: KEY });
    expect(noPrice.stt).toBeNull();
    expect(noPrice.warnings.join()).toMatch(/STT_USD_PER_HOUR/);
    expect(noPrice.warnings.join()).not.toContain(KEY);
    expect(loadConfig({ ...env, STT_BASE_URL: 'http://example.com/v1' }).stt).toBeNull();
  });
  it('VOICE_PORT turns the endpoint on', () => {
    expect(loadConfig({}).voiceHttp).toBeNull();
    expect(loadConfig({ VOICE_PORT: '8091', VOICE_HOST: '0.0.0.0' }).voiceHttp).toEqual({ host: '0.0.0.0', port: 8091 });
  });
});

describe('transcribe', () => {
  it('posts the audio, model and verbose_json with the key; returns trimmed text and the length', async () => {
    const { f, seen } = fakeFetch();
    const r = await transcribe(loadConfig(env).stt!, audio, 'audio/webm', { fetchImpl: f });
    expect(r).toEqual({ text: 'phòng mấy độ', seconds: 2.5 });
    expect(seen[0]!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(seen[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.form.get('model')).toBe('whisper-large-v3-turbo');
    expect(seen[0]!.form.get('response_format')).toBe('verbose_json');
    expect((seen[0]!.form.get('file') as File).name).toBe('speech.webm');
    expect(seen[0]!.form.get('prompt')).toMatch(/phòng ngủ mấy độ/);
    expect(seen[0]!.form.get('language')).toBe('vi');
  });
  it('STT_PROMPT replaces the word hint; empty sends none', async () => {
    const { f, seen } = fakeFetch();
    await transcribe(loadConfig({ ...env, STT_PROMPT: 'bếp, ban công' }).stt!, audio, 'audio/webm', { fetchImpl: f });
    await transcribe(loadConfig({ ...env, STT_PROMPT: '' }).stt!, audio, 'audio/webm', { fetchImpl: f });
    expect(seen.map((s) => s.form.get('prompt'))).toEqual(['bếp, ban công', null]);
    await transcribe(loadConfig({ ...env, STT_LANGUAGE: '' }).stt!, audio, 'audio/webm', { fetchImpl: f });
    expect(seen[2]!.form.get('language')).toBeNull(); // empty: Whisper guesses (mixed English commands)
  });
  it('a provider error that echoes the key never carries it further', async () => {
    const { f } = fakeFetch({ status: 401, body: { error: `Invalid API Key ${KEY}` } });
    const e = (await transcribe(loadConfig(env).stt!, audio, 'audio/webm', { fetchImpl: f }).catch((x: unknown) => x)) as SttFailed;
    expect(e).toBeInstanceOf(SttFailed);
    expect(e.code).toBe('provider');
    expect(e.message).not.toContain(KEY);
  });
  it('unreachable provider is offline', async () => {
    const f = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    await expect(transcribe(loadConfig(env).stt!, audio, 'audio/webm', { fetchImpl: f })).rejects.toMatchObject({ code: 'offline' });
  });
});

describe('cleanTranscript: what Whisper invents on noise is dropped', () => {
  const prompt = STT_PROMPT;
  it('video outros, alone or after a real command', () => {
    expect(cleanTranscript('Cảm ơn các bạn đã theo dõi và hẹn gặp lại.', prompt)).toBe('');
    expect(cleanTranscript('Để không bỏ lỡ những video hấp dẫn.', prompt)).toBe('');
    expect(cleanTranscript('Hãy subscribe cho kênh Ghiền Mì Gõ để không bỏ lỡ những video hấp dẫn', prompt)).toBe('');
    expect(cleanTranscript('Bật đèn phòng khách. Cảm ơn các bạn đã theo dõi.', prompt)).toBe('Bật đèn phòng khách.');
  });
  it('one word over and over', () => {
    expect(cleanTranscript('Đã trẻ ngạc nguồn, nguồn, nguồn, nguồn, nguồn, nguồn.', prompt)).toBe('');
  });
  it('the prompt read back in pieces, but a real command that is also in the prompt stays', () => {
    expect(cleanTranscript('Lịch hôm nay, phòng ngủ.', prompt)).toBe('');
    expect(cleanTranscript('Lịch hôm nay.', prompt)).toBe('Lịch hôm nay.');
    expect(cleanTranscript('Bật đèn phòng khách.', prompt)).toBe('Bật đèn phòng khách.');
    expect(cleanTranscript('Phòng ngủ mấy độ, bật đèn giúp.', prompt)).toBe('Phòng ngủ mấy độ, bật đèn giúp.');
  });
  it('real speech passes untouched', () => {
    for (const s of ['Độ ẩm bao nhiêu?', 'Nhắc tôi 3 giờ chiều gọi mẹ.', 'phòng mấy độ', 'turn on the light']) expect(cleanTranscript(s, prompt)).toBe(s);
  });
  it('the brain answers an invented sentence with empty text: nothing is acted on', async () => {
    const { f } = fakeFetch({ body: { text: ' Cảm ơn các bạn đã theo dõi và hẹn gặp lại.', duration: 5.4 } });
    const { d, store } = deps(loadConfig(env), f);
    expect(await speechToText(d, audio, 'audio/wav')).toBe('');
    expect(store.sttSecondsOn(dayOf(Date.now()))).toBe(5.4); // still paid for, still counted
  });
});

describe('speechToText caps', () => {
  it('counts seconds and cost, and tells the screen', async () => {
    const { f } = fakeFetch();
    const { d, store, spent } = deps(loadConfig(env), f);
    expect(await speechToText(d, audio, 'audio/webm')).toBe('phòng mấy độ');
    const day = dayOf(Date.now());
    expect(store.sttSecondsOn(day)).toBe(2.5);
    expect(store.spentUsd(day)).toBeCloseTo((2.5 / 3600) * 0.04, 10);
    expect(store.usageOn(day).usd).toBeCloseTo((2.5 / 3600) * 0.04, 10);
    expect(spent()).toBe(1);
  });
  it('refuses without calling the provider: off, too big, not audio, budget reached, minutes reached', async () => {
    const { f, seen } = fakeFetch();
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: SttFailed) => e.code);
    expect(await code(speechToText(deps(loadConfig({}), f).d, audio, 'audio/webm'))).toBe('off');
    expect(await code(speechToText(deps(loadConfig(env), f).d, new Uint8Array(1024 * 1024 + 1), 'audio/webm'))).toBe('too_big');
    expect(await code(speechToText(deps(loadConfig(env), f).d, audio, 'text/plain'))).toBe('not_audio');
    const broke = new Store(':memory:');
    broke.logStt(Date.now(), 'groq', 'm', 1, 1);
    expect(await code(speechToText(deps(loadConfig(env), f, broke).d, audio, 'audio/webm'))).toBe('budget');
    const talked = new Store(':memory:');
    talked.logStt(Date.now(), 'groq', 'm', 30 * 60, 0);
    expect(await code(speechToText(deps(loadConfig(env), f, talked).d, audio, 'audio/webm'))).toBe('minutes');
    expect(seen).toHaveLength(0);
  });
});

describe('voiceServer', () => {
  let srv: Server | null = null;
  afterEach(() => void srv?.close());
  async function start(cfg: Config, f: typeof fetch) {
    const x = deps(cfg, f);
    srv = voiceServer(x.d);
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    return { ...x, url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/voice/stt` };
  }

  it('GET says whether speech to text is on; POST returns the words', async () => {
    const { url } = await start(loadConfig(env), fakeFetch().f);
    expect(await (await fetch(url)).json()).toEqual({ on: true });
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus' }, body: audio });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: 'phòng mấy độ' });
  });
  it('errors are a code for the dashboard, never the key', async () => {
    const { url, logs } = await start(loadConfig(env), fakeFetch({ status: 401, body: { error: KEY } }).f);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audio });
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ error: 'provider' });
    expect(text + logs.join('\n')).not.toContain(KEY);
  });
  it('more than 1 MB is refused; other paths are 404; off is 503', async () => {
    const { url } = await start(loadConfig({ BRAIN_DB: ':memory:' }), fakeFetch().f);
    expect(await (await fetch(url)).json()).toEqual({ on: false });
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audio })).status).toBe(503);
    expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: new Uint8Array(1024 * 1024 + 10) })).status).toBe(413);
    expect((await fetch(url.replace('/voice/stt', '/other'))).status).toBe(404);
  });
});
