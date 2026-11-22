import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SYSTEM_BACKUP, SYSTEM_COMMAND, SYSTEM_HEALTH, SYSTEM_WATCH, systemCommand } from '@vega/contract';
import { Agent } from './agent';
import { Assistant } from './assistant';
import type { ChatFn } from './agent';
import { BRAIN_SUBSCRIPTIONS, connect, mqttBus } from './bus';
import type { Config } from './config';
import { CiWatcher, GithubClient, ciEvent, ciScene } from './github';
import { HealthWatch, diskFreeOf } from './health';
import { Locator } from './locate';
import { Memory } from './memory';
import { PhonePush } from './phone';
import { GoogleApi, GoogleAuth } from './google';
import { piStatsReader } from './pistats';
import { Registry } from './registry';
import { Store } from './store';
import { voiceServer } from './voice';
import { FrameCache, SAMPLE_PHOTO, fileCamera, httpCamera } from './vision';
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
  /** The phone's location (M8). */
  locator: Locator;
  /** The Pi's health (M8), null off the Pi. */
  health: HealthWatch | null;
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
  const phone = cfg.phone ? new PhonePush({ config: cfg.phone, atHome: () => locator.atHome, log }) : null;
  if (phone) log(`[phone] alerts through ntfy at ${cfg.phone!.url}`);
  assistant = new Assistant({
    bus,
    registry,
    store,
    config: cfg,
    ci,
    google: g ? new GoogleApi(new GoogleAuth(g), g) : null,
    weather: w ? () => fetchWeather(w) : null,
    log,
    ...(phone && { push: (s, label) => void phone.push(s, label) }),
    ...(opts.now && { now: opts.now }),
  });
  const locator = new Locator({ store, home: cfg.home, homeRegions: cfg.homeRegions, presence: (home) => bus.presence(home), log, ...(opts.now && { now: opts.now }) });
  const dbDir = cfg.dbPath === ':memory:' ? '.' : dirname(resolve(cfg.dbPath));
  const health = cfg.health.on
    ? new HealthWatch({ backupMaxH: cfg.health.backupMaxH, notify: (s, label) => assistant!.notify(s, label), log, diskFreePct: () => diskFreeOf(dbDir), phoneError: () => phone?.error ?? null, ...(opts.now && { now: opts.now }) })
    : null;
  let healthTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let piTimer: ReturnType<typeof setInterval> | null = null;
  const cam = cfg.camera;
  const vision = { camera: cam.sim ? fileCamera(fileURLToPath(SAMPLE_PHOTO)) : httpCamera(cam.device, cam.url), frames: new FrameCache(120_000, opts.now) };
  const memory = new Memory(store, opts.now ?? Date.now);
  const agent = new Agent({ bus, registry, config: cfg, store, log, ci, assistant, vision, locator, health, memory, ...(opts.chat && { chat: opts.chat }), ...(opts.now && { now: opts.now }) });
  const vh = cfg.voiceHttp;
  /** A command as the owner, through the same queue as MQTT commands; resolves with the logged answer. */
  const runCommand = (text: string): Promise<{ id: string; answer: string }> => {
    const id = `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const done = queue.then(() => agent.handle({ id, text, origin: 'owner' }));
    queue = done.catch((e: unknown) => log(`[brain] command ${id} failed: ${(e as Error).stack ?? e}`));
    return done.then(() => ({ id, answer: store.lastCommands(20).find((c) => c.id === id)?.answer ?? '' }));
  };
  const api = { config: cfg, store, registry, health, locator, memory, command: runCommand, ...(opts.now && { now: opts.now }) };
  const voice = vh ? voiceServer({ config: cfg, store, log, onSpent: () => agent.publishUsage(), frames: vision.frames, api, ...(opts.now && { now: opts.now }) }) : null;
  // plugged / unplugged, for the CAM OFF chip (D9)
  let camPresent: boolean | null = null;
  const checkCamera = () => {
    const p = vision.camera.present();
    if (p === camPresent) return;
    camPresent = p;
    bus.camera(p);
    log(`[vision] camera ${p ? `${cam.sim ? 'sim' : cam.device} ready` : `${cam.device} unplugged`}`);
  };
  let camTimer: ReturnType<typeof setInterval> | null = null;
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
    camPresent = null; // a reconnected broker may have lost the retained state
    checkCamera();
    camTimer ??= setInterval(checkCamera, 5000);
    if (cfg.piStats && !piTimer) {
      const readPi = piStatsReader();
      const sample = () => {
        const s = readPi();
        bus.pi(s);
        health?.onTemp(s.tempC);
      };
      piTimer = setInterval(sample, 30_000);
      setTimeout(sample, 2000); // a first CPU sample needs a short interval
    }
    locator.republish();
    if (health && !healthTimer)
      healthTimer = setInterval(() => {
        void phone?.recheck();
        health.check();
      }, 60_000);
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
    if (topic === SYSTEM_HEALTH) return void health?.onHealth(payload.toString());
    if (topic === SYSTEM_BACKUP) return void health?.onBackup(payload.toString());
    if (topic === SYSTEM_WATCH) return void health?.onWatch(payload.toString());
    if (topic.startsWith('owntracks/')) return locator.onMessage(topic, payload.toString());
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
    locator,
    health,
    voicePort,
    idle: () => queue.then(() => {}),
    stop: () =>
      new Promise<void>((res) => {
        voice?.close();
        ci?.stop();
        assistant!.stop();
        if (piTimer) clearInterval(piTimer);
        if (camTimer) clearInterval(camTimer);
        if (healthTimer) clearInterval(healthTimer);
        client.end(false, {}, () => {
          store.close();
          res();
        });
      }),
  };
}
