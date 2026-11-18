/**
 * `npm run scene -- <name> [file.json] [--ttl N] [--level normal|medium|high] [--url URL] [--user U --pass P] [--raw]`
 * Publishes a retained scene on vega/ui/scene. Without a file it uses tools/sim/examples/<name>.json, or a bare
 * scene if there is none. The scene is validated against packages/contract first; `--raw` sends the file as is
 * (to test how displays treat a broken payload).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mqtt from 'mqtt';
import { SCENES, UI_SCENE, parseScene } from '@vega/contract';
import type { SceneName } from '@vega/contract';

export interface SceneArgs {
  name: string;
  file?: string;
  ttl?: number;
  level?: string;
  raw: boolean;
  url: string;
  user?: string;
  pass?: string;
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): SceneArgs {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (k === 'raw') flags[k] = true;
      else if (nxt !== undefined && !nxt.startsWith('--')) {
        flags[k] = nxt;
        i++;
      } else flags[k] = true;
    } else pos.push(a);
  }
  const [name, file] = pos;
  if (!name) throw new Error(`usage: npm run scene -- <${SCENES.join('|')}> [file.json] [--ttl N] [--level L] [--url URL] [--raw]`);
  const str = (k: string): string | undefined => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
  const ttl = str('ttl') === undefined ? undefined : Number(str('ttl'));
  if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 1)) throw new Error('--ttl must be a positive integer (seconds)');
  return {
    name,
    ...(file && { file }),
    ...(ttl !== undefined && { ttl }),
    ...(str('level') && { level: str('level') }),
    raw: flags.raw === true,
    url: str('url') ?? env.MQTT_URL ?? 'mqtt://localhost:1883',
    ...(str('user') ?? env.MQTT_USER ? { user: str('user') ?? env.MQTT_USER } : {}),
    ...(str('pass') ?? env.MQTT_PASS ? { pass: str('pass') ?? env.MQTT_PASS } : {}),
  };
}

const EXAMPLES = resolve(import.meta.dirname, '../examples');

/** Returns the string to publish. Throws with a readable message when the scene is invalid. */
export function buildPayload(a: SceneArgs, now: Date = new Date(), read: (p: string) => string = (p) => readFileSync(p, 'utf8'), exists: (p: string) => boolean = existsSync): string {
  const path = a.file ? resolve(a.file) : resolve(EXAMPLES, `${a.name}.json`);
  const hasFile = a.file ? true : exists(path);
  if (a.file && !exists(path)) throw new Error(`file not found: ${a.file}`);
  if (a.raw) {
    if (!hasFile) throw new Error('--raw needs a file');
    return read(path);
  }
  let value: unknown;
  if (hasFile) {
    try {
      value = JSON.parse(read(path));
    } catch {
      throw new Error(`${path} is not valid JSON (use --raw to send it anyway)`);
    }
  } else {
    if (!(SCENES as readonly string[]).includes(a.name)) throw new Error(`unknown scene "${a.name}". Known: ${SCENES.join(', ')}`);
    value = { v: 1, scene: a.name as SceneName };
  }
  const obj = { ...(value as Record<string, unknown>) };
  if (obj.scene === undefined) obj.scene = a.name;
  else if (obj.scene !== a.name) throw new Error(`file holds scene "${String(obj.scene)}" but "${a.name}" was requested`);
  if (a.ttl !== undefined) obj.ttl = a.ttl;
  if (a.level) obj.level = a.level;
  obj.ts = now.toISOString(); // a fresh timestamp, so ttl counts from now and old retained copies expire correctly
  const r = parseScene(obj);
  if (!r.ok) throw new Error(`invalid scene: ${r.error} (use --raw to send it anyway)`);
  return JSON.stringify(r.scene);
}

export async function publishScene(a: SceneArgs, payload: string): Promise<void> {
  const c = mqtt.connect(a.url, { username: a.user, password: a.pass, reconnectPeriod: 0, connectTimeout: 4000, clientId: `vega-scene-${process.pid}` });
  await new Promise<void>((res, rej) => {
    c.once('error', rej);
    c.once('connect', () => {
      c.publish(UI_SCENE, payload, { retain: true, qos: 1 }, (err) => (err ? rej(err) : res()));
    });
  });
  await new Promise<void>((res) => c.end(false, {}, () => res()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const payload = buildPayload(a);
    await publishScene(a, payload);
    console.log(`[scene] published "${a.name}" to ${a.url} (${UI_SCENE}, retained, ${payload.length} bytes)`);
  } catch (e) {
    console.error(`[scene] ${(e as Error).message}`);
    process.exit(1);
  }
}
