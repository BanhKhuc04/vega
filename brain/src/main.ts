import { SYSTEM_COMMAND, systemCommand } from '@vega/contract';
import { Agent } from './agent';
import { BRAIN_SUBSCRIPTIONS, connect, mqttBus } from './bus';
import { loadConfig } from './config';
import { Registry } from './registry';

const cfg = loadConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
for (const w of cfg.warnings) log(`[brain] config: ${w}`);
log(`[brain] LLM router=${cfg.tasks.router ?? 'none'} chat=${cfg.tasks.chat ?? 'none'}`);

const registry = new Registry();
const client = connect(cfg.mqttUrl, { ...(cfg.mqttUser && { username: cfg.mqttUser }), ...(cfg.mqttPass && { password: cfg.mqttPass }) });
const agent = new Agent({ bus: mqttBus(client), registry, config: cfg, log });

// one command at a time, in arrival order
let queue: Promise<unknown> = Promise.resolve();

client.on('connect', () => {
  log(`[brain] connected to ${cfg.mqttUrl}`);
  client.subscribe(BRAIN_SUBSCRIPTIONS);
});
client.on('error', (e) => log(`[brain] mqtt error: ${e.message}`));
client.on('message', (topic, payload) => {
  if (topic !== SYSTEM_COMMAND) return void registry.apply(topic, payload.toString());
  let raw: unknown;
  try {
    raw = JSON.parse(payload.toString());
  } catch {
    return log('[brain] ignored command: invalid JSON');
  }
  const r = systemCommand.safeParse(raw);
  if (!r.success) return log('[brain] ignored command: does not match the contract');
  const cmd = { id: r.data.id, text: r.data.text, origin: 'owner' as const };
  queue = queue.then(() => agent.handle(cmd)).catch((e: unknown) => log(`[brain] command ${cmd.id} failed: ${(e as Error).stack ?? e}`));
});

const stop = () => client.end(false, {}, () => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
