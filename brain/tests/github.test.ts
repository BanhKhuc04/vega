import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { CiWatcher, GithubClient, ciEvent, ciScene, trimLog } from '../src/github';
import type { CiState, Run } from '../src/github';
import { parseScene } from '@vega/contract';
import { fakeGithub } from './fakegithub';

describe('config', () => {
  it('CI watching needs a token and owner/repo names', () => {
    expect(loadConfig({}).github).toBeNull();
    const c = loadConfig({ GITHUB_TOKEN: 't', GITHUB_REPOS: 'me/vega, bad name, me/fw' });
    expect(c.github).toEqual({ token: 't', repos: ['me/vega', 'me/fw'], apiUrl: 'https://api.github.com', intervalMs: 60_000 });
    expect(c.warnings.join('\n')).toMatch(/"bad name" ignored/);
    expect(loadConfig({ GITHUB_REPOS: 'me/vega' }).github).toBeNull();
    expect(loadConfig({ GITHUB_TOKEN: 't', GITHUB_REPOS: 'me/vega', GITHUB_API_URL: 'http://evil.example' }).github).toBeNull();
    expect(loadConfig({ GITHUB_TOKEN: 't', GITHUB_REPOS: 'me/vega', GITHUB_POLL_S: '5' }).github!.intervalMs).toBe(60_000); // under 30 s: ignored, default
    expect(loadConfig({ GITHUB_TOKEN: 't', GITHUB_REPOS: 'me/vega', GITHUB_POLL_S: '120' }).github!.intervalMs).toBe(120_000);
  });
});

describe('ciEvent / ciScene', () => {
  const run = (o: Partial<Run>): Run => ({ repo: 'me/vega', workflow: 'ci', conclusion: 'failure', runId: 4, url: 'https://github.com/me/vega/actions/runs/4', sha: 'abcdef4', message: 'feat: break it', actor: 'khuc', at: 2, ...o });
  it('one slot for every watched repo', () => {
    expect(ciEvent({ failing: [], passing: [], checkedAt: 0 }, ['me/vega'])).toEqual({ repo: 'me/vega', failed: 0 });
    expect(ciEvent({ failing: [], passing: [], checkedAt: 0 }, ['me/vega', 'me/fw'])).toEqual({ repo: '2 repos', failed: 0 });
    expect(ciEvent({ failing: [run({ repo: 'me/fw' })], passing: [], checkedAt: 0 }, ['me/vega', 'me/fw'])).toEqual({ repo: 'me/fw', failed: 1 });
  });
  it('alert names the newest broken run and offers Explain / Open; success lists the green workflows; both are valid scenes', () => {
    const state: CiState = { failing: [run({ runId: 3, at: 1, workflow: 'old' }), run({})], passing: [], checkedAt: 0 };
    const a = ciScene(state, 'failed');
    expect(a).toMatchObject({ scene: 'alert', data: { title: 'build failed', ref: 'me/vega · ci', error: 'abcdef4 feat: break it — khuc', explain: true, url: 'https://github.com/me/vega/actions/runs/4' } });
    expect(parseScene({ v: 1, ...a }).ok).toBe(true);
    const s = ciScene({ failing: [], passing: [run({ conclusion: 'success' })], checkedAt: 0 }, 'recovered');
    expect(s).toMatchObject({ scene: 'success', data: { title: 'me/vega', checks: ['ci · me/vega'] } });
    expect(parseScene({ v: 1, ...s }).ok).toBe(true);
  });
});

describe('trimLog', () => {
  it('keeps the lines around the last error, without timestamps, within the size limit', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `2026-11-19T03:00:00.0000000Z line ${i}`);
    lines[300] = '2026-11-19T03:00:00.0000000Z src/relay.cpp:42: error: WiFiClient was not declared';
    const out = trimLog(lines.join('\n'));
    expect(out).toContain('src/relay.cpp:42: error: WiFiClient was not declared');
    expect(out).not.toMatch(/2026-11-19T/);
    expect(out.split('\n')).toHaveLength(150);
    expect(out.startsWith('line 200')).toBe(true);
    expect(trimLog('x'.repeat(10_000)).length).toBe(6000);
    expect(trimLog('a\nb').split('\n')).toEqual(['a', 'b']); // no error line: the end of the log
  });
});

describe('CiWatcher over a fake GitHub', () => {
  let gh: Awaited<ReturnType<typeof fakeGithub>>;
  let states: { state: CiState; change: string | null }[];
  let logs: string[];
  let now: number;
  const make = (token = gh.token) =>
    new CiWatcher(new GithubClient({ token, apiUrl: gh.apiUrl }), {
      repos: ['me/vega'],
      onState: (state, change) => states.push({ state, change }),
      log: (m) => logs.push(m),
      now: () => now,
    });

  beforeEach(async () => {
    gh = await fakeGithub();
    states = [];
    logs = [];
    now = 1_000_000;
    gh.setRuns('me/vega', [
      { id: 2, workflow_id: 1, name: 'ci', conclusion: 'success' },
      { id: 1, workflow_id: 1, name: 'ci', conclusion: 'failure' }, // older run of the same workflow: ignored
      { id: 3, workflow_id: 2, name: 'docs', conclusion: 'success' },
    ]);
  });
  afterEach(() => gh.close());

  it('first poll sets the baseline; a new failure says "failed"; unchanged says nothing; green again says "recovered"', async () => {
    const w = make();
    await w.pollOnce();
    expect(states.at(-1)).toMatchObject({ change: null, state: { failing: [] } });
    expect(states.at(-1)!.state.passing.map((r) => r.workflow)).toEqual(['ci', 'docs']);

    gh.setRuns('me/vega', [
      { id: 4, workflow_id: 1, name: 'ci', conclusion: 'failure', message: 'feat: break the build\n\nlong body', actor: 'khuc' },
      { id: 3, workflow_id: 2, name: 'docs', conclusion: 'success' },
    ]);
    await w.pollOnce();
    expect(states.at(-1)!.change).toBe('failed');
    expect(states.at(-1)!.state.failing).toEqual([
      expect.objectContaining({ repo: 'me/vega', workflow: 'ci', runId: 4, url: 'https://github.com/me/vega/actions/runs/4', message: 'feat: break the build', actor: 'khuc', sha: 'abcdef4' }),
    ]);

    await w.pollOnce();
    expect(states.at(-1)!.change).toBeNull(); // same failing run: no second alarm
    expect(gh.seen.filter((s) => s.path.includes('/actions/runs?')).at(-1)!.ifNoneMatch).toBe('"v2"'); // answered 304

    gh.setRuns('me/vega', [{ id: 5, workflow_id: 1, name: 'ci', conclusion: 'success' }, { id: 3, workflow_id: 2, name: 'docs', conclusion: 'success' }]);
    await w.pollOnce();
    expect(states.at(-1)!.change).toBe('recovered');
  });

  it('offline: keeps the last state, raises nothing', async () => {
    const w = make();
    gh.setRuns('me/vega', [{ id: 4, workflow_id: 1, name: 'ci', conclusion: 'failure' }]);
    await w.pollOnce();
    await gh.close();
    const n = states.length;
    await w.pollOnce();
    expect(states.length).toBe(n); // nothing new published
    expect(w.latest()!.failing).toHaveLength(1);
    expect(logs.at(-1)).toMatch(/unreachable/);
    gh = await fakeGithub(); // for afterEach
  });

  it('a rejected token is reported once and polling pauses for 10 minutes; the token never shows up in messages', async () => {
    const w = make('wrong-token');
    await w.pollOnce();
    await w.pollOnce();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/token rejected; pausing 10 min/);
    expect(logs.join(' ')).not.toContain('wrong-token');
    expect(gh.seen).toHaveLength(1);
    now += 10 * 60_000 + 1;
    await w.pollOnce();
    expect(gh.seen).toHaveLength(2);
  });

  it('explain: finds the failing job and step, follows the log redirect without the token, trims the log', async () => {
    const w = make();
    gh.setRuns('me/vega', [{ id: 7, workflow_id: 1, name: 'ci', conclusion: 'failure' }]);
    gh.setLog(7, ['setup', 'npm test', 'FAIL tests/relay.test.ts', '  expected true, got false', '##[error]Process completed with exit code 1.'].join('\n'));
    await w.pollOnce();
    const x = await w.explain();
    expect(x).toMatchObject({ job: 'test', step: 'npm test', run: { runId: 7 } });
    expect(x!.excerpt).toContain('FAIL tests/relay.test.ts');
    const storage = gh.seen.find((s) => s.path.startsWith('/storage/'))!;
    expect(storage.auth).toBeUndefined();
    expect(await make().explain()).toBeNull(); // nothing failing known
  });
});
