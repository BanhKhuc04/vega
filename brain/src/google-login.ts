/**
 * `npm run google-login`: signs VEGA in to Google once (read-only Calendar + Gmail) and writes the refresh token to
 * GOOGLE_TOKEN_FILE (default: next to BRAIN_DB). On the Pi, run it on a PC and copy the file over (README, Google).
 */
import { spawn } from 'node:child_process';
import { loadConfig } from './config';
import { login } from './google';

try {
  process.loadEnvFile();
} catch {
  // settings may come from the environment instead
}
const g = loadConfig().google;
if (!g) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (README, section Google).');
  process.exit(1);
}

const openBrowser = (url: string) => {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args as string[], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  console.log(`\nA browser window should open. If it does not, open this address:\n\n${url}\n`);
};

try {
  const r = await login({ ...g, open: openBrowser });
  console.log(`Signed in. Token saved to ${g.tokenFile} (scopes: ${r.scope || 'read-only'}).`);
  console.log('Restart VEGA (npm run vega) to see your calendar and mail.');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
