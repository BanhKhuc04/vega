/**
 * `npm run vega`: everything on one PC in one process — dev broker (no auth), simulated devices, the brain (settings
 * from `.env`) and the dashboard connected to them. Ctrl+C stops it all. Dev only; the Pi uses infra/pi.
 */
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { startBroker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import { startVisionLive } from '../../tools/sim/src/vision-live';
import { loadConfig } from './config';
import { startBrain } from './service';
import { SAMPLE_PHOTO } from './vision';

try {
  process.loadEnvFile();
} catch {
  // no .env: local commands only
}
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const broker = await startBroker({ port: Number(process.env.MQTT_PORT ?? 1883), wsPort: Number(process.env.MQTT_WS_PORT ?? 9001) }).catch((e: Error) => {
  console.error(`Cannot start the broker (${e.message}). Is another broker, or "npm run broker", already running?`);
  process.exit(1);
});
const url = `mqtt://127.0.0.1:${broker.port}`;
// Vision on a PC: a sample photo, looked at by the free mock model, unless .env says otherwise
const cfg = loadConfig({ CAMERA: 'sim', LLM_VISION: 'mock', ...process.env, MQTT_URL: url, MQTT_USER: '', MQTT_PASS: '', VOICE_PORT: process.env.VOICE_PORT || '8091', VOICE_HOST: '127.0.0.1' });
// with real CI watched, the simulator neither fakes a CI state nor runs its demo CI -> scene rule
const sim = await runSim({ url, ...(cfg.github && { initialCi: 'none' as const, sceneRule: false }), ...(cfg.google && { nextEvent: false }) });
for (const w of cfg.warnings) log(`[brain] config: ${w}`);
const brain = startBrain(cfg, { log });

process.env.VITE_DATA_SOURCE = 'mqtt';
process.env.VITE_MQTT_URL = `ws://127.0.0.1:${broker.wsPort}`;
const root = fileURLToPath(new URL('../../dashboard/', import.meta.url));
// the page asks its own address for /voice/*, as behind nginx on the Pi. Piper on a PC: VOICE_TTS_URL=http://127.0.0.1:5002
const voicePort = await brain.voicePort;
// live mode of the Vision screen (M7.1): a stand-in for vega-vision, which runs on the Pi
const live = await startVisionLive(fileURLToPath(SAMPLE_PHOTO));
const proxy = {
  '/vision/live': `http://127.0.0.1:${live.port}`,
  ...(voicePort && { '/voice/stt': `http://127.0.0.1:${voicePort}`, '/vision/frame': `http://127.0.0.1:${voicePort}` }),
  ...(process.env.VOICE_TTS_URL && { '/voice/tts': process.env.VOICE_TTS_URL }),
};
const ui = await createServer({ root, configFile: `${root}vite.config.ts`, server: { proxy, ...(process.env.PORT && { port: Number(process.env.PORT) }) } });
await ui.listen();
console.log(`\nVEGA is running · AI: ${cfg.tasks.router ?? 'none (local commands only)'} · budget $${cfg.budgetUsdDay}/day`);
ui.printUrls();
console.log('Open the address above, type or press the mic. Ctrl+C to stop.\n');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await ui.close();
  await brain.stop();
  live.server.closeAllConnections();
  live.server.close();
  await sim.stop();
  await broker.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
