import { SYSTEM_COMMAND, systemCommand } from '@vega/contract';
import { Agent } from './agent';
import { Assistant } from './assistant';
import type { ChatFn } from './agent';
import { BRAIN_SUBSCRIPTIONS, connect, mqttBus } from './bus';
import type { Config } from './config';
import { CiWatcher, GithubClient, ciEvent, ciScene } from './github';
import { GoogleApi, GoogleAuth } from './google';
import { piStatsReader } from './pistats';
import { Registry } from './registry';
import { Store } from './store';
import { voiceServer } from './voice';
import { fetchWeather } from './weather';

/** A command older than this (or retained) is a replay, not the owner speaking now. */
const MAX_AGE_MS = 30_000;

export interface Brain {
  registry: Registry;
  store: Store;
  /** GitHub Actions watcher, when configured. */
  ci: CiWatcher | null;
  /** Calendar, mail, weather, briefing, reminders, Focus. */
  assistant: Assistant;
  /** Port of the `/voice/stt` endpoint once listening, null when VOICE_PORT is not set. */
  voicePort: Promise<number | null>;
  /** Resolves once every command received so far has been answered. */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

/** Connects to the broker and serves `vega/system/command`. Used by `main.ts` and, in-process, by the e2e tests. */
export function startBrain(cfg: Config, opts: { log?: (msg: string) => void; chat?: ChatFn; now?: () => number } = {}): Brain {
  const log = opts.log ?? (() => {});
  const registry = new Registry();
  const store = new Store(cfg.dbPath);
  const client = connect(cfg.mqttUrl, { ...(cfg.mqttUser && { username: cfg.mqttUser }), ...(cfg.mqttPass && { password: cfg.mqttPass }) });
  let queue: Promise<unknown> = Promise.resolve(); // one command at a time, in arrival order
  const bus = mqttBus(client);
  const gh = cfg.github;
  // assigned below: CI scenes go through it, so they wait during Focus
  let assistant: Assistant | null = null;
  const ci = gh
    ? new CiWatcher(new GithubClient(gh), {
        repos: gh.repos,
        log,
        onState(state, change) {
          const e = ciEvent(state, gh.repos);
          bus.ci(e.repo, e.failed);
          if (change) {
            log(`[ci] builds ${change}: ${state.failing.map((r) => `${r.repo}/${r.workflow}`).join(', ') || 'all green'}`);
            const label = change === 'failed' ? `CI failed: ${state.failing.map((r) => `${r.repo}/${r.workflow}`).join(', ')}` : 'CI green again';
            assistant!.notify(ciScene(state, change), label.slice(0, 80));
          }
        },
      })
    : null;
  const g = cfg.google;
  const w = cfg.weather;
  assistant = new Assistant({
    bus,
    registry,
    store,
    config: cfg,
    ci,
    google: g ? new GoogleApi(new GoogleAuth(g), g) : null,
    weather: w ? () => fetchWeather(w) : null,
    log,
    ...(opts.now && { now: opts.now }),
  });
  let started = false;
  let piTimer: ReturnType<typeof setInterval> | null = null;
  const agent = new Agent({ bus, registry, config: cfg, store, log, ci, assistant, ...(opts.chat && { chat: opts.chat }), ...(opts.now && { now: opts.now }) });
  const vh = cfg.voiceHttp;
  const voice = vh ? voiceServer({ config: cfg, store, log, onSpent: () => agent.publishUsage(), ...(opts.now && { now: opts.now }) }) : null;
  const voicePort = new Promise<number | null>((resolve) => {
    if (!voice || !vh) return resolve(null);
    voice.on('error', (e) => {
      log(`[voice] cannot listen on ${vh.host}:${vh.port} (${e.message}): voice input falls back to the browser`);
      resolve(null);
    });
    voice.listen(vh.port, vh.host, () => {
      const port = (voice.address() as { port: number }).port;
      log(`[voice] /voice/stt on ${vh.host}:${port} · speech to text ${cfg.stt ? `${cfg.stt.provider} ${cfg.stt.model}, ${cfg.stt.maxMinDay} min/day` : 'off (no STT_API_KEY)'}`);
      resolve(port);
    });
  });

  client.on('connect', () => {
    log(`[brain] connected to ${cfg.mqttUrl}`);
    client.subscribe(BRAIN_SUBSCRIPTIONS);
    agent.publishUsage();
    if (cfg.piStats && !piTimer) {
      const readPi = piStatsReader();
      piTimer = setInterval(() => bus.pi(readPi()), 30_000);
      setTimeout(() => bus.pi(readPi()), 2000); // a first CPU sample needs a short interval
    }
    if (!started) {
      started = true;
      assistant!.start();
      if (ci) {
        log(`[ci] watching ${gh!.repos.join(', ')} every ${gh!.intervalMs / 1000} s`);
        ci.start(gh!.intervalMs);
      }
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
    assistant,
    voicePort,
    idle: () => queue.then(() => {}),
    stop: () =>
      new Promise<void>((res) => {
        voice?.close();
        ci?.stop();
        assistant!.stop();
        if (piTimer) clearInterval(piTimer);
        client.end(false, {}, () => {
          store.close();
          res();
        });
      }),
  };
}
