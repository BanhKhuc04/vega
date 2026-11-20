import { createServer } from 'node:http';
import type { Server } from 'node:http';

/** A stand-in for an OpenAI-compatible `/audio/transcriptions` (Groq, OpenAI): checks the key, answers one fixed text. */
export async function fakeStt(opts: { key?: string; text?: string; duration?: number } = {}) {
  const key = opts.key ?? 'gsk-test-stt-secret';
  const seen: { bytes: number; contentType: string }[] = [];
  const server: Server = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (c: Buffer) => (bytes += c.length));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url !== '/audio/transcriptions' || req.method !== 'POST') return void ((res.statusCode = 404), res.end('{}'));
      if (req.headers.authorization !== `Bearer ${key}`) return void ((res.statusCode = 401), res.end('{"error":{"message":"Invalid API Key"}}'));
      seen.push({ bytes, contentType: String(req.headers['content-type']) });
      res.end(JSON.stringify({ text: opts.text ?? 'phòng mấy độ', duration: opts.duration ?? 1.5, language: 'vietnamese' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    key,
    seen,
    env: { STT_API_KEY: key, STT_BASE_URL: url, STT_PROVIDER: 'fake', STT_MODEL: 'whisper-fake', STT_USD_PER_HOUR: '0.04' },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
