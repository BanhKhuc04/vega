/**
 * GitHub Actions watching (Brief 0005): plain `fetch` to the REST API every minute, with ETags so unchanged answers
 * come back as 304 and do not count against the rate limit. The token is only ever put in the request header.
 */
import type { GithubConfig } from './config';

export class GithubError extends Error {
  constructor(
    readonly kind: 'offline' | 'auth' | 'rate' | 'http',
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class GithubClient {
  private readonly cache = new Map<string, { etag: string; body: unknown }>();
  constructor(
    private readonly cfg: Pick<GithubConfig, 'token' | 'apiUrl'>,
    private readonly f: Fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'vega-brain',
      authorization: `Bearer ${this.cfg.token}`,
      ...extra,
    };
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.f(`${this.cfg.apiUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new GithubError('offline', `GitHub unreachable: ${(e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message}`);
    }
  }

  private fail(res: Response, path: string): never {
    if (res.status === 401) throw new GithubError('auth', `GitHub ${res.status} on ${path}: token rejected`);
    if (res.status === 403 || res.status === 429)
      throw res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429
        ? new GithubError('rate', `GitHub rate limit on ${path}`)
        : new GithubError('auth', `GitHub ${res.status} on ${path}: token lacks access`);
    throw new GithubError('http', `GitHub ${res.status} on ${path}`);
  }

  /** GET a JSON resource; an unchanged one is answered from the cache (304). */
  async get<T>(path: string): Promise<T> {
    const hit = this.cache.get(path);
    const res = await this.send(path, { headers: this.headers(hit ? { 'if-none-match': hit.etag } : {}) });
    if (res.status === 304 && hit) return hit.body as T;
    if (!res.ok) this.fail(res, path);
    const body = (await res.json()) as T;
    const etag = res.headers.get('etag');
    if (etag) this.cache.set(path, { etag, body });
    return body;
  }

  /** Job logs: GitHub answers with a redirect to storage, which must be fetched without the token. */
  async logs(path: string): Promise<string> {
    const res = await this.send(path, { headers: this.headers(), redirect: 'manual' });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (to) {
      let r2: Response;
      try {
        r2 = await this.f(to, { signal: AbortSignal.timeout(20_000) }); // no authorization header here
      } catch (e) {
        throw new GithubError('offline', `log download failed: ${(e as Error).message}`);
      }
      if (!r2.ok) throw new GithubError('http', `log download ${r2.status}`);
      return r2.text();
    }
    if (!res.ok) this.fail(res, path);
    return res.text();
  }
}

export interface Run {
  repo: string;
  workflow: string;
  conclusion: string;
  runId: number;
  url: string;
  sha: string;
  message: string;
  actor: string;
  at: number;
}
export interface CiState {
  failing: Run[];
  passing: Run[];
  checkedAt: number;
}

interface ApiRun {
  id: number;
  name?: string | null;
  workflow_id: number;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
  head_commit?: { message?: string } | null;
  actor?: { login?: string } | null;
  updated_at?: string;
}

const FAILED = new Set(['failure', 'timed_out']);

export interface WatcherDeps {
  repos: string[];
  /** Called after every poll that reached GitHub; `change` says whether builds just broke or recovered. */
  onState(state: CiState, change: 'failed' | 'recovered' | null): void;
  log?: (msg: string) => void;
  now?: () => number;
}

/** Polls the last completed run of every workflow on each repo's default branch. */
export class CiWatcher {
  private state: CiState | null = null;
  private branches = new Map<string, string>();
  private pausedUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;

  constructor(
    private readonly gh: GithubClient,
    private readonly deps: WatcherDeps,
  ) {
    this.log = deps.log ?? (() => {});
    this.now = deps.now ?? Date.now;
  }

  latest(): CiState | null {
    return this.state;
  }

  start(intervalMs: number): void {
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async repoRuns(repo: string): Promise<Run[]> {
    let branch = this.branches.get(repo);
    if (!branch) {
      branch = (await this.gh.get<{ default_branch: string }>(`/repos/${repo}`)).default_branch;
      this.branches.set(repo, branch);
    }
    const { workflow_runs: runs } = await this.gh.get<{ workflow_runs: ApiRun[] }>(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=30`);
    const seen = new Set<number>();
    const out: Run[] = [];
    for (const r of runs) {
      if (seen.has(r.workflow_id)) continue; // newest first: the first one is the latest of that workflow
      seen.add(r.workflow_id);
      out.push({
        repo,
        workflow: r.name ?? `workflow ${r.workflow_id}`,
        conclusion: r.conclusion ?? 'unknown',
        runId: r.id,
        url: r.html_url,
        sha: r.head_sha.slice(0, 7),
        message: (r.head_commit?.message ?? '').split('\n')[0]!,
        actor: r.actor?.login ?? '',
        at: Date.parse(r.updated_at ?? '') || this.now(),
      });
    }
    return out;
  }

  /** One round over all repos. A repo GitHub could not answer keeps its previous runs: no false alarm when offline. */
  async pollOnce(): Promise<void> {
    if (this.busy || this.now() < this.pausedUntil) return;
    this.busy = true;
    try {
      const prev = this.state;
      const runs: Run[] = [];
      let reached = false;
      for (const repo of this.deps.repos) {
        try {
          runs.push(...(await this.repoRuns(repo)));
          reached = true;
        } catch (e) {
          const err = e as GithubError;
          if (err.kind === 'auth' || err.kind === 'rate') {
            this.pausedUntil = this.now() + 10 * 60_000;
            this.log(`[ci] ${err.message}; pausing 10 min`);
            return;
          }
          this.log(`[ci] ${repo}: ${err.message}`);
          runs.push(...(prev ? [...prev.failing, ...prev.passing].filter((r) => r.repo === repo) : []));
        }
      }
      if (!reached) return; // nothing new: keep the last state (the screen marks it stale)
      const failing = runs.filter((r) => FAILED.has(r.conclusion));
      const passing = runs.filter((r) => !FAILED.has(r.conclusion));
      this.state = { failing, passing, checkedAt: this.now() };
      const key = (r: Run) => `${r.repo}#${r.workflow}#${r.runId}`;
      const before = new Set((prev?.failing ?? []).map(key));
      const change = !prev ? null : failing.some((r) => !before.has(key(r))) ? 'failed' : prev.failing.length > 0 && failing.length === 0 ? 'recovered' : null;
      this.deps.onState(this.state, change);
    } finally {
      this.busy = false;
    }
  }

  /** Log excerpt of the most recent failing run (in `repo` if given), for the LLM to explain. */
  async explain(repo?: string): Promise<{ run: Run; job: string; step: string; excerpt: string } | null> {
    const run = (this.state?.failing ?? []).filter((r) => !repo || r.repo === repo).sort((a, b) => b.at - a.at)[0];
    if (!run) return null;
    const { jobs } = await this.gh.get<{ jobs: { id: number; name: string; conclusion: string | null; steps?: { name: string; conclusion: string | null }[] }[] }>(
      `/repos/${run.repo}/actions/runs/${run.runId}/jobs?filter=latest`,
    );
    const job = jobs.find((j) => j.conclusion && FAILED.has(j.conclusion)) ?? jobs[0];
    if (!job) return { run, job: '', step: '', excerpt: '' };
    const step = job.steps?.find((s) => s.conclusion && FAILED.has(s.conclusion))?.name ?? '';
    const text = await this.gh.logs(`/repos/${run.repo}/actions/jobs/${job.id}/logs`);
    return { run, job: job.name, step, excerpt: trimLog(text) };
  }
}

const TS = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/;
const ERR = /##\[error\]|\berror\b|\bfailed\b|\bexception\b|✗|\bFAIL\b/i;

/** About 150 lines around the last error line, timestamps removed, at most `max` characters (the end is kept). */
export function trimLog(text: string, max = 6000): string {
  const lines = text.split(/\r?\n/).map((l) => l.replace(TS, ''));
  let i = -1;
  for (let k = lines.length - 1; k >= 0; k--) if (ERR.test(lines[k]!)) {
    i = k;
    break;
  }
  const part = i < 0 ? lines.slice(-150) : lines.slice(Math.max(0, i - 100), i + 50);
  const out = part.join('\n').trim();
  return out.length > max ? out.slice(out.length - max) : out;
}
