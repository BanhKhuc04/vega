import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface FakeRun {
  id: number;
  workflow_id: number;
  name: string;
  conclusion: string;
  message?: string;
  actor?: string;
}

/**
 * A small stand-in for the GitHub REST API: repo info, completed runs (with ETag / 304), jobs, and job logs served
 * through a redirect to a second "storage" path, like GitHub does.
 */
export async function fakeGithub(opts: { token?: string } = {}) {
  const token = opts.token ?? 'ghp_test_secret';
  const runs = new Map<string, FakeRun[]>();
  const logs = new Map<number, string>();
  const seen: { path: string; auth?: string; ifNoneMatch?: string }[] = [];
  let status = 200;
  let version = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    seen.push({ path: url.pathname + url.search, auth: req.headers.authorization, ifNoneMatch: req.headers['if-none-match'] as string | undefined });
    const json = (o: unknown, etag?: string) => {
      res.setHeader('content-type', 'application/json');
      if (etag) res.setHeader('etag', etag);
      res.end(JSON.stringify(o));
    };
    if (url.pathname.startsWith('/storage/')) return res.end(logs.get(Number(url.pathname.split('/')[2])) ?? '');
    if (req.headers.authorization !== `Bearer ${token}`) return ((res.statusCode = 401), res.end('{"message":"Bad credentials"}'));
    if (status !== 200) return ((res.statusCode = status), res.end('{}'));
    let m: RegExpMatchArray | null;
    if ((m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/))) return json({ default_branch: 'main', full_name: m[1] });
    if ((m = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/runs$/))) {
      const etag = `"v${version}"`;
      if (req.headers['if-none-match'] === etag) return ((res.statusCode = 304), res.end());
      const list = (runs.get(m[1]!) ?? []).map((r) => ({
        id: r.id,
        workflow_id: r.workflow_id,
        name: r.name,
        conclusion: r.conclusion,
        html_url: `https://github.com/${m![1]}/actions/runs/${r.id}`,
        head_sha: `abcdef${r.id}000`,
        head_commit: { message: r.message ?? 'fix: something\n\nbody' },
        actor: { login: r.actor ?? 'owner' },
        updated_at: new Date(1_800_000_000_000 + r.id * 1000).toISOString(),
      }));
      return json({ total_count: list.length, workflow_runs: list }, etag);
    }
    if ((m = url.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/))) {
      const id = Number(m[1]);
      return json({ jobs: [{ id: id * 10, name: 'test', conclusion: 'failure', steps: [{ name: 'Checkout', conclusion: 'success' }, { name: 'npm test', conclusion: 'failure' }] }] });
    }
    if ((m = url.pathname.match(/\/actions\/jobs\/(\d+)\/logs$/))) {
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${port}/storage/${Number(m[1]) / 10}`);
      return res.end();
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    token,
    apiUrl: `http://127.0.0.1:${port}`,
    seen,
    /** Replaces the runs of a repo (newest first) and bumps the ETag. */
    setRuns(repo: string, list: FakeRun[]) {
      runs.set(repo, list);
      version++;
    },
    setLog(runId: number, text: string) {
      logs.set(runId, text);
    },
    setStatus(s: number) {
      status = s;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
