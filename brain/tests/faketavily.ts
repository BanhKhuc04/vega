import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface FakeHit {
  title: string;
  url: string;
  content: string;
}

/** A stand-in for Tavily's /search: results per query (or a default list), the key checked, every request recorded. */
export async function fakeTavily(opts: { key?: string } = {}) {
  const key = opts.key ?? 'tvly-test-secret';
  const byQuery = new Map<string, FakeHit[]>();
  let fallback: FakeHit[] = [];
  const seen: { query: string; auth?: string; body: Record<string, unknown> }[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as Record<string, unknown>;
      seen.push({ query: String(j.query), ...(req.headers.authorization && { auth: req.headers.authorization }), body: j });
      res.setHeader('content-type', 'application/json');
      if (req.url !== '/search') return void ((res.statusCode = 404), res.end('{}'));
      if (req.headers.authorization !== `Bearer ${key}`) return void ((res.statusCode = 401), res.end('{"detail":{"error":"Unauthorized"}}'));
      const hits = byQuery.get(String(j.query)) ?? fallback;
      res.end(JSON.stringify({ query: j.query, results: hits.slice(0, Number(j.max_results) || 5).map((h, i) => ({ title: h.title, url: h.url, content: h.content.slice(0, 200), raw_content: h.content, score: 1 - i / 10 })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    key,
    url,
    seen,
    env: { TAVILY_API_KEY: key, TAVILY_API_URL: url },
    setResults: (query: string, hits: FakeHit[]) => void byQuery.set(query, hits),
    setDefault: (hits: FakeHit[]) => void (fallback = hits),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Five pages on four sites about cheap CO₂ sensors. */
export const CO2_PAGES: FakeHit[] = [
  { title: 'SCD40 vs MH-Z19B vs SenseAir S8', url: 'https://sensors.example.com/co2-compare', content: 'The SCD40 is a photoacoustic NDIR sensor, small, about 18 USD. The MH-Z19B is NDIR, around 15 USD, needs 5 V.' },
  { title: 'MH-Z19B datasheet', url: 'https://winsen.example.cn/mh-z19b', content: 'MH-Z19B measures 0-5000 ppm with ±(50 ppm + 5%) accuracy, UART and PWM output.' },
  { title: 'SenseAir S8 review', url: 'https://www.homelab.example.org/s8-review', content: 'SenseAir S8 is the most stable over months, about 25 USD, works with ESP8266 over UART at 3.3 V logic.' },
  { title: 'SCD40 on ESP8266', url: 'https://blog.example.net/scd40-esp8266', content: 'SCD40 uses I2C, runs at 3.3 V, and ESPHome supports it out of the box.' },
  { title: 'Another page on the same site', url: 'https://sensors.example.com/co2-guide', content: 'Calibrate NDIR sensors outdoors at 420 ppm.' },
];
