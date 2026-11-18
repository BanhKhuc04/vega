import { SYSTEM_COMMAND } from '@vega/contract';
import { BRAIN_SUBSCRIPTIONS, connect } from './bus';
import { loadConfig } from './config';
import { Registry } from './registry';

const cfg = loadConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const registry = new Registry();

const client = connect(cfg.mqttUrl, { ...(cfg.mqttUser && { username: cfg.mqttUser }), ...(cfg.mqttPass && { password: cfg.mqttPass }) });
client.on('connect', () => {
  log(`[brain] connected to ${cfg.mqttUrl}`);
  client.subscribe(BRAIN_SUBSCRIPTIONS);
});
client.on('error', (e) => log(`[brain] mqtt error: ${e.message}`));
client.on('message', (topic, payload) => {
  if (topic === SYSTEM_COMMAND) return log(`[brain] command: ${payload.toString()}`);
  registry.apply(topic, payload.toString());
});

const stop = () => client.end(false, {}, () => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
