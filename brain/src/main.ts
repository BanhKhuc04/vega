import { loadConfig } from './config';
import { startBrain } from './service';

try {
  process.loadEnvFile(); // `.env` in the working directory, if any; never overrides the real environment
} catch {
  // no .env: settings come from the environment (compose, brain.env)
}
const cfg = loadConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
for (const w of cfg.warnings) log(`[brain] config: ${w}`);
log(`[brain] LLM router=${cfg.tasks.router ?? 'none'} chat=${cfg.tasks.chat ?? 'none'} · budget $${cfg.budgetUsdDay}/day · db ${cfg.dbPath}`);

const brain = startBrain(cfg, { log });
const stop = () => void brain.stop().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
