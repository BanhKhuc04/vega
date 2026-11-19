import { parseScene } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { Agent } from '../src/agent';
import type { AgentDeps, ChatFn } from '../src/agent';
import type { Bus } from '../src/bus';
import { loadConfig } from '../src/config';
import type { Config } from '../src/config';
import { chat } from '../src/llm';
import { Store } from '../src/store';
import { simRegistry } from '../bench/registry';

/** A bus that records what the brain sends, after checking every scene against the contract like a display would. */
export function recordingBus() {
  const scenes: SceneMessage[] = [];
  const results: { id: string; text: string }[] = [];
  const sets: { device: string; on: boolean }[] = [];
  const usage: Parameters<Bus['usage']>[0][] = [];
  const ci: { repo: string; failed: number }[] = [];
  const said: string[] = [];
  const next: { title: string; detail?: string; at: number }[] = [];
  const bus: Bus = {
    scene(s) {
      const r = parseScene({ v: 1, ...s });
      if (!r.ok) throw new Error(`invalid scene: ${r.error}`);
      scenes.push(r.scene);
    },
    result: (id, text) => results.push({ id, text }),
    setDevice: (room, id, on) => sets.push({ device: `${room}/${id}`, on }),
    usage: (u) => usage.push(u),
    ci: (repo, failed) => ci.push({ repo, failed }),
    pi: () => {},
    announce: (text) => said.push(text),
    nextEvent: (title, detail, at) => next.push({ title, ...(detail && { detail }), at }),
  };
  const thinks = () => scenes.filter((s): s is Extract<SceneMessage, { scene: 'think' }> => s.scene === 'think');
  return { bus, scenes, results, sets, thinks, usage, ci, said, next };
}

export function makeAgent(opts: { env?: Record<string, string>; chat?: ChatFn; config?: Partial<Config>; temp?: number; deps?: Partial<AgentDeps> } = {}) {
  const rec = recordingBus();
  const registry = simRegistry({ ...(opts.temp !== undefined && { temp: opts.temp }) });
  const config = { ...loadConfig({ LLM_ROUTER: 'mock', ...opts.env }), ...opts.config };
  const llm = { calls: 0 };
  const spy: ChatFn = (p, req, o) => {
    llm.calls++;
    return (opts.chat ?? chat)(p, req, o);
  };
  const store = new Store(':memory:');
  const agent = new Agent({ bus: rec.bus, registry, config, store, chat: spy, ...opts.deps });
  return { agent, registry, config, llm, store, ...rec };
}
