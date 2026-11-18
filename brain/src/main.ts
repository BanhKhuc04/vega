import mqtt from 'mqtt';
import { SYSTEM_COMMAND } from '@vega/contract';
import { loadConfig } from './config';

const cfg = loadConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const client = mqtt.connect(cfg.mqttUrl, {
  clientId: `vega-brain-${process.pid}`,
  username: cfg.mqttUser,
  password: cfg.mqttPass,
  reconnectPeriod: 2000,
});
client.on('connect', () => {
  log(`[brain] connected to ${cfg.mqttUrl}`);
  client.subscribe([SYSTEM_COMMAND]);
});
client.on('error', (e) => log(`[brain] mqtt error: ${e.message}`));
client.on('message', (topic, payload) => log(`[brain] ${topic}: ${payload.toString()}`));

const stop = () => client.end(false, {}, () => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
