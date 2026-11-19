/**
 * Web search (Brief 0007, R1–R2). One provider for now, Tavily: it returns each page's main text with the result, so
 * the brain never fetches a web page itself. The monthly allowance is counted in SQLite and never exceeded.
 */
import type { Config } from './config';
import type { Store } from './store';

export interface SearchHit {
  title: string;
  url: string;
  /** The page's text as the provider extracted it (outside content). */
  text: string;
}

export class SearchError extends Error {
  constructor(
    readonly kind: 'off' | 'quota' | 'offline' | 'auth' | 'http',
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class WebSearch {
  constructor(
    private readonly cfg: NonNullable<Config['search']>,
    private readonly store: Store,
    private readonly now: () => number = Date.now,
    private readonly f: Fetch = fetch,
  ) {}

  /** Searches left this month. */
  left(): number {
    return Math.max(0, this.cfg.maxMonth - this.store.searchesInMonth(this.now()));
  }

  async search(query: string, commandId: string, max = 5): Promise<SearchHit[]> {
    if (this.left() <= 0) throw new SearchError('quota', `monthly web search limit reached (${this.cfg.maxMonth})`);
    this.store.logSearch(this.now(), commandId, 'tavily', query.slice(0, 400)); // counted before the call: a timeout still used a credit
    let res: Response;
    try {
      res = await this.f(`${this.cfg.apiUrl}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({ query: query.slice(0, 400), search_depth: 'basic', max_results: max, include_answer: false, include_raw_content: 'text' }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new SearchError('offline', `web search unreachable: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new SearchError('auth', `web search ${res.status}: key rejected`);
    if (res.status === 429 || res.status === 432) throw new SearchError('quota', `web search ${res.status}: provider limit reached`);
    if (!res.ok) throw new SearchError('http', `web search ${res.status}`);
    const j = (await res.json()) as { results?: { title?: string; url?: string; content?: string; raw_content?: string | null }[] };
    return (j.results ?? [])
      .filter((r): r is { title?: string; url: string; content?: string; raw_content?: string | null } => typeof r.url === 'string' && /^https:\/\/\S+$/.test(r.url) && r.url.length <= 500)
      .map((r) => ({ title: (r.title?.trim() || hostOf(r.url)).slice(0, 120), url: r.url, text: (r.raw_content?.trim() || r.content?.trim() || '').replace(/\s+/g, ' ') }))
      .filter((r) => r.text.length > 0);
  }
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
