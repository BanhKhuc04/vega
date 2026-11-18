/**
 * `npm run sim`: virtual devices that publish to a broker following packages/contract.
 *   MQTT_URL=mqtt://localhost:1883 npm run sim        (default; or ws://localhost:9001)
 *   npm run sim -- --url mqtt://pi.local:1883 --user vega --pass secret
 *   npm run sim -- --initial-ci fail                  start with one failing build
 * Type `fail`, `pass`, `kill <room/id>` or `revive <room/id>` on stdin while it runs.
 */
import { createInterface } from 'node:readline';
import { runSim } from './simlib';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = opt('url') ?? process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const initialCi = (opt('initial-ci') ?? 'pass') as 'none' | 'pass' | 'fail';

const sim = await runSim({
  url,
  username: opt('user') ?? process.env.MQTT_USER,
  password: opt('pass') ?? process.env.MQTT_PASS,
  intervalMs: Number(opt('interval') ?? 2000),
  initialCi,
  log: (m) => console.log(m),
}).catch((e: Error) => {
  console.error(`[sim] cannot connect to ${url}: ${e.message}`);
  console.error('      start a broker first: npm run broker  (or docker compose -f infra/docker-compose.dev.yml up)');
  process.exit(1);
});

console.log(`[sim] ${sim.deviceKeys.length} virtual devices online via ${url}`);
console.log('[sim] stdin: fail | pass | kill <room/id> | revive <room/id>   devices: ' + sim.deviceKeys.join(', '));
createInterface({ input: process.stdin }).on('line', (line) => {
  const [cmd, arg] = line.trim().split(/\s+/);
  if (cmd === 'fail') sim.setCi(1);
  else if (cmd === 'pass') sim.setCi(0);
  else if (cmd === 'kill' && arg) void sim.killDevice(arg);
  else if (cmd === 'revive' && arg) void sim.reviveDevice(arg);
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void sim.stop().then(() => process.exit(0)));
