/** `npm run broker`: a Docker-free dev broker on 1883 (MQTT) and 9001 (WebSocket). Dev only. */
import { startBroker } from './broker';

const port = Number(process.env.MQTT_PORT ?? 1883);
const wsPort = Number(process.env.MQTT_WS_PORT ?? 9001);
const b = await startBroker({ port, wsPort, host: process.env.MQTT_HOST ?? '127.0.0.1' });
console.log(`[broker] dev broker (no auth, no TLS): mqtt://127.0.0.1:${b.port}  ws://127.0.0.1:${b.wsPort}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void b.close().then(() => process.exit(0)));
}
