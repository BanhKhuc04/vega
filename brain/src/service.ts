import { SYSTEM_COMMAND, systemCommand } from '@vega/contract';
import { Agent } from './agent';
import type { ChatFn } from './agent';
import { BRAIN_SUBSCRIPTIONS, connect, mqttBus } from './bus';
import type { Config } from './config';
import { CiWatcher, GithubClient, ciEvent, ciScene } from './github';
import { Registry } from './registry';
import { Store } from './store';

/** A command older than this (or retained) is a replay, not the owner speaking now. */
const MAX_AGE_MS = 30_000;

export interface Brain {
  registry: Registry;
  store: Store;
  /** GitHub Actions watcher, when configured. */
  ci: CiWatcher | null;
  /** Resolves once every command received so far has been answered. */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

/** Connects to the broker and serves `vega/system/command`. Used by `main.ts` and, in-process, by the e2e tests. */
export function startBrain(cfg: Config, opts: { log?: (msg: string) => void; chat?: ChatFn } = {}): Brain {
  const log = opts.log ?? (() => {});
  const registry = new Registry();
  const store = new Store(cfg.dbPath);
  const client = connect(cfg.mqttUrl, { ...(cfg.mqttUser && { username: cfg.mqttUser }), ...(cfg.mqttPass && { password: cfg.mqttPass }) });
  let queue: Promise<unknown> = Promise.resolve(); // one command at a time, in arrival order
  const bus = mqttBus(client);
  const gh = cfg.github;
  const ci = gh
    ? new CiWatcher(new GithubClient(gh), {
        repos: gh.repos,
        log,
        onState(state, change) {
          const e = ciEvent(state, gh.repos);
          bus.ci(e.repo, e.failed);
          if (change) {
            log(`[ci] builds ${change}: ${state.failing.map((r) => `${r.repo}/${r.workflow}`).join(', ') || 'all green'}`);
            bus.scene(ciScene(state, change));
          }
        },
      })
    : null;
  let started = false;
  const agent = new Agent({ bus, registry, config: cfg, store, log, ...(opts.chat && { chat: opts.chat }) });

  client.on('connect', () => {
    log(`[brain] connected to ${cfg.mqttUrl}`);
    client.subscribe(BRAIN_SUBSCRIPTIONS);
    agent.publishUsage();
    if (ci && !started) {
      started = true;
      log(`[ci] watching ${gh!.repos.join(', ')} every ${gh!.intervalMs / 1000} s`);
      ci.start(gh!.intervalMs);
    }
  });
  client.on('error', (e) => log(`[brain] mqtt error: ${e.message}`));
  client.on('message', (topic, payload, packet) => {
    if (topic !== SYSTEM_COMMAND) return void registry.apply(topic, payload.toString());
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      return log('[brain] ignored command: invalid JSON');
    }
    const r = systemCommand.safeParse(raw);
    if (!r.success) return log('[brain] ignored command: does not match the contract');
    if (packet.retain) return log(`[security] ignored retained command ${r.data.id}`);
    const age = Date.now() - Date.parse(r.data.ts);
    if (!(Math.abs(age) <= MAX_AGE_MS)) return log(`[security] ignored stale command ${r.data.id} (${Math.round(age / 1000)} s old)`);
    const cmd = { id: r.data.id, text: r.data.text, origin: 'owner' as const };
    queue = queue.then(() => agent.handle(cmd)).catch((e: unknown) => log(`[brain] command ${cmd.id} failed: ${(e as Error).stack ?? e}`));
  });

  return {
    registry,
    store,
    ci,
    idle: () => queue.then(() => {}),
    stop: () =>
      new Promise<void>((res) => {
        ci?.stop();
        client.end(false, {}, () => {
          store.close();
          res();
        });
      }),
  };
}
