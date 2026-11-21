import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { SYSTEM_COMMAND, UI_SCENE, deviceTopic, parseScene } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import type { Sim } from '../../tools/sim/src/simlib';
import { loadConfig } from '../../brain/src/config';
import { startBrain } from '../../brain/src/service';
import { dayOf } from '../../brain/src/store';
import type { Brain } from '../../brain/src/service';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeGithub } from '../../brain/tests/fakegithub';
import { fakeGoogle } from '../../brain/tests/fakegoogle';
import { CO2_PAGES, fakeTavily } from '../../brain/tests/faketavily';
import { fakeStt } from '../../brain/tests/fakestt';
import type { ChatFn } from '../../brain/src/agent';
import { T, watch } from './helpers';
import type { Watch } from './helpers';

/**
 * M1 end to end: broker (in process) + simulator + brain (in process, LLM provider `mock`) + dashboard in Chromium.
 * The owner types on the command bar; the brain answers on the screen and drives the virtual devices.
 */

let broker: Broker;
let sim: Sim;
let brain: Brain;
let spy: MqttClient;
const opened: BrowserContext[] = [];
const last = new Map<string, string>();
const scenes: SceneMessage[] = [];

test.beforeEach(async () => {
  last.clear();
  scenes.length = 0;
  broker = await startBroker({ port: 0, wsPort: 0 });
  const url = `mqtt://127.0.0.1:${broker.port}`;
  spy = mqtt.connect(url, { reconnectPeriod: 200 });
  await new Promise<void>((r) => spy.once('connect', () => r()));
  spy.on('message', (t, p) => {
    last.set(t, p.toString());
    if (t === UI_SCENE) {
      const r = parseScene(p.toString());
      if (r.ok) scenes.push(r.scene);
    }
  });
  await spy.subscribeAsync('vega/#');
  // one reading each, so the expected values hold still; the brain (not the sim's demo rule) decides CI scenes here
  sim = await runSim({ url, intervalMs: 60_000, piIntervalMs: 60_000, initialCi: 'none', sceneRule: false });
  brain = startBrain(loadConfig({ MQTT_URL: url, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:' }));
  await expect.poll(() => brain.registry.switches().length && brain.registry.sensors('co2').length, { timeout: 5000 }).toBe(2);
});

test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => {});
  await brain.stop().catch(() => {});
  await sim.stop().catch(() => {});
  spy.end(true);
  await broker.close().catch(() => {});
});

async function openPage(browser: Browser, before?: (page: Page) => Promise<void>): Promise<{ page: Page; w: Watch }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
  opened.push(ctx);
  const page = await ctx.newPage();
  // a recording stand-in for the browser's voice, with one English and one Vietnamese voice installed
  await page.addInitScript(() => {
    const spoken: { text: string; lang: string }[] = [];
    Object.assign(window, {
      __spoken: spoken,
      SpeechSynthesisUtterance: class {
        lang = '';
        voice: unknown = null;
        constructor(readonly text: string) {}
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak: (u: { text: string; lang: string }) => spoken.push({ text: u.text, lang: u.lang }), cancel() {}, getVoices: () => [{ lang: 'en-US', name: 'En' }, { lang: 'vi-VN', name: 'Vi' }] },
    });
  });
  const w = await watch(page);
  await before?.(page); // routes added after watch() take precedence over it
  await page.goto(`/?quality=css&source=mqtt&mqtt=${encodeURIComponent(`ws://127.0.0.1:${broker.wsPort}`)}`);
  await expect(page.locator('#connTxt')).toHaveText('LIVE', { timeout: 6000 });
  return { page, w };
}

/** Fake vega-voice behind `/voice/tts`, and an Audio element that records what it plays. Returns the TTS requests. */
async function fakePiper(page: Page): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route('**/voice/tts?*', (route) => {
    asked.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from('RIFF0000WAVEfmt ') });
  });
  await page.addInitScript(() => {
    const played: string[] = [];
    Object.assign(window, {
      __played: played,
      Audio: class {
        onended: unknown = null;
        onerror: unknown = null;
        constructor(readonly src: string) {}
        play() {
          played.push(this.src);
          return Promise.resolve();
        }
        pause() {}
      },
    });
    // this machine has no Vietnamese voice
    (window.speechSynthesis as unknown as { getVoices: () => unknown[] }).getVoices = () => [{ lang: 'en-US', name: 'En' }];
  });
  return asked;
}

test('M5: answers are read by Piper (fake vega-voice), Vietnamese included, on a machine without a Vietnamese voice', async ({ browser }) => {
  let asked: URL[] = [];
  const { page, w } = await openPage(browser, async (p) => void (asked = await fakePiper(p)));
  await say(page, 'nhắc nhở của tôi');
  await expect(page.locator('#chat .msg.vega span')).toHaveText(['Không có lời nhắc nào.'], { timeout: T(4000) });
  await expect.poll(() => asked.map((u) => [u.pathname, u.searchParams.get('text'), u.searchParams.get('lang')])).toEqual([['/voice/tts', 'Không có lời nhắc nào.', 'vi']]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __played: string[] }).__played.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __spoken: unknown[] }).__spoken)).toEqual([]); // speechSynthesis never used
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

test('M5: hold the mic, speak (Chromium fake mic), release: the brain transcribes (fake STT), "You" shows it, VEGA answers', async ({ browser }) => {
  const stt = await fakeStt({ text: 'phòng mấy độ', duration: 1.5 });
  await brain.stop();
  brain = startBrain(loadConfig({ MQTT_URL: `mqtt://127.0.0.1:${broker.port}`, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:', VOICE_PORT: '0', ...stt.env }));
  const port = await brain.voicePort;
  try {
    // the page asks its own address, as through nginx on the Pi: forward /voice/stt to the brain under test
    const { page, w } = await openPage(browser, async (p) => {
      await p.route('**/voice/stt', async (route) => route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${port}/voice/stt` }) }));
    });
    await expect.poll(() => brain.registry.switches().length && brain.registry.sensors('co2').length, { timeout: 5000 }).toBe(2);
    const temp = reading('bedroom', 'temp_c');
    const mic = page.locator('#micBtn');
    await page.waitForTimeout(500); // the boot-time check of GET /voice/stt
    const box = (await mic.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(mic).toHaveClass(/\bon\b/, { timeout: T(3000) });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await expect(page.locator('#chat .msg.you span')).toHaveText(['phòng mấy độ'], { timeout: T(5000) });
    await expect(page.locator('#chat .msg.vega span')).toHaveText([`Bedroom ${temp.toFixed(1)}°C`], { timeout: T(4000) });
    expect(stt.seen).toHaveLength(1);
    // the request carries the recording (an empty blob never leaves the page: ptt.test.ts); its size depends on the platform's fake mic
    expect(brain.store.sttSecondsOn(dayOf(Date.now()))).toBe(1.5);
    await expect(mic).not.toHaveClass(/\bon\b/);
    expect(w.errors).toEqual([]);
    expect(w.external).toEqual([]);
  } finally {
    await stt.close();
  }
});

test('M5.2: the voice agent wakes (Listen), its command and the answer show in the chat but are not read here; MIC OFF chip', async ({ browser }) => {
  let asked: URL[] = [];
  const { page, w } = await openPage(browser, async (p) => void (asked = await fakePiper(p)));
  // the simulator's ESP "desk/core" left a retained `idle` here: let it arrive first, or it would end the Listen below
  await expect.poll(() => page.evaluate(() => document.querySelector('#app')?.getAttribute('data-mode')), { timeout: T(2000) }).toBe('idle');
  await page.waitForTimeout(500);
  // the agent heard its wake word
  spy.publish('vega/desk/core/state', JSON.stringify({ v: 1, state: 'listening', mic: 'on' }), { retain: true });
  await expect.poll(() => mode(page), { timeout: T(2000) }).toBe('listen');
  await expect(page.locator('#micChip')).toBeHidden();
  // what it heard, sent as a command the way pc-agent does
  spy.publish(SYSTEM_COMMAND, JSON.stringify({ v: 1, id: 'VOICE-e2e-1', text: 'nhắc nhở của tôi', ts: new Date().toISOString(), via: 'voice' }));
  await expect(page.locator('#chat .msg.you span')).toHaveText(['nhắc nhở của tôi'], { timeout: T(4000) });
  await expect(page.locator('#chat .msg.vega span')).toHaveText(['Không có lời nhắc nào.'], { timeout: T(4000) });
  await page.waitForTimeout(800);
  expect(asked).toEqual([]); // the agent reads it on its own speaker: no second voice here
  expect(await page.evaluate(() => (window as unknown as { __spoken: unknown[] }).__spoken)).toEqual([]);
  // the owner pressed the hotkey
  spy.publish('vega/desk/core/state', JSON.stringify({ v: 1, state: 'idle', mic: 'off' }), { retain: true });
  await expect(page.locator('#micChip')).toBeVisible({ timeout: T(2000) });
  await expect(page.locator('#micChip')).toHaveText('MIC OFF');
  spy.publish('vega/desk/core/state', JSON.stringify({ v: 1, state: 'idle', mic: 'on' }), { retain: true });
  await expect(page.locator('#micChip')).toBeHidden({ timeout: T(2000) });
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

test('M7: "trên bàn có gì?" shows the photo just taken (sim camera) with a box and label per object; CAM OFF when unplugged', async ({ browser }) => {
  await brain.stop();
  brain = startBrain(loadConfig({ MQTT_URL: `mqtt://127.0.0.1:${broker.port}`, LLM_ROUTER: 'mock', LLM_VISION: 'mock', CAMERA: 'sim', BRAIN_DB: ':memory:', VOICE_PORT: '0' }));
  const port = await brain.voicePort;
  const photos: number[] = [];
  const { page, w } = await openPage(browser, async (p) => {
    // as through nginx on the Pi: /vision/frame/<id> goes to the brain under test
    await p.route('**/vision/frame/*', async (route) => {
      const response = await route.fetch({ url: `http://127.0.0.1:${port}${new URL(route.request().url()).pathname}` });
      photos.push(response.status());
      await route.fulfill({ response });
    });
  });
  await expect.poll(() => last.get('vega/desk/camera/state'), { timeout: T(3000) }).toBe(JSON.stringify({ v: 1, camera: 'on' }));
  await say(page, 'trên bàn có gì?');
  await expect.poll(() => mode(page), { timeout: T(4000) }).toBe('vision');
  await expect.poll(() => photos, { timeout: T(4000) }).toEqual([200]);
  await expect(page.locator('#vtotal')).toHaveText('7');
  await expect(page.locator('#vlayer .vcard')).toHaveCount(7);
  await expect(page.locator('#vlayer .vcard span').first()).toHaveText('Raspberry Pi');
  await expect(page.locator('#feed')).toHaveAttribute('aria-label', /^Camera photo of the desk: Raspberry Pi, ESP8266/);
  await expect(page.locator('.vctl')).toBeHidden(); // "Inspect Pi" belongs to the painted demo desk
  await expect.poll(() => page.locator('#vcount').textContent(), { timeout: T(5000) }).toBe('7');
  await expect(page.locator('#chat .msg.vega span')).toHaveText([/^Một Raspberry Pi/], { timeout: T(2000) });
  // unplugged: the chip in the header, and the scene the brain sends when asked
  spy.publish('vega/desk/camera/state', JSON.stringify({ v: 1, camera: 'missing' }), { retain: true });
  await expect(page.locator('#camChip')).toBeVisible({ timeout: T(2000) });
  await expect(page.locator('#camChip')).toHaveText('CAM OFF');
  spy.publish(UI_SCENE, JSON.stringify({ v: 1, scene: 'vision', ttl: 60, data: { camera: 'CAM-01', status: 'unplugged' } }), { retain: true });
  await expect(page.locator('#feed')).toHaveAttribute('aria-label', 'Camera unplugged', { timeout: T(2000) });
  await expect(page.locator('#vlayer .vcard')).toHaveCount(0);
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

async function say(page: Page, text: string): Promise<string> {
  const before = last.get(SYSTEM_COMMAND);
  await page.locator('#q').fill(text);
  await page.locator('#q').press('Enter');
  await expect.poll(() => last.get(SYSTEM_COMMAND) !== before && last.get(SYSTEM_COMMAND), { timeout: T(2000) }).toBeTruthy();
  return (JSON.parse(last.get(SYSTEM_COMMAND)!) as { id: string }).id;
}

const reading = (room: string, key: string) => JSON.parse(last.get(deviceTopic(room, 'env', 'state'))!)[key] as number;
const relayOn = (room: string, id: string) => (JSON.parse(last.get(deviceTopic(room, id, 'state')) ?? '{}') as { on?: boolean }).on;
const mode = (p: Page) => p.locator('#app').getAttribute('data-mode');

test('"phòng mấy độ, bật đèn giúp": the sim temperature on screen, the virtual relay on, 0 LLM calls in the ledger', async ({ browser }) => {
  const { page, w } = await openPage(browser);
  const temp = reading('bedroom', 'temp_c');
  expect(relayOn('livingroom', 'light')).toBe(false);
  const id = await say(page, 'phòng mấy độ, bật đèn giúp');
  await expect(page.locator('#caption')).toHaveText(`Bedroom ${temp.toFixed(1)}°C · Living room light on`, { timeout: T(4000) });
  await expect.poll(() => relayOn('livingroom', 'light'), { timeout: T(2000) }).toBe(true);
  expect(brain.store.llmCallsFor(id)).toBe(0);
  expect(brain.store.lastCommands(1)[0]).toMatchObject({ id, path: 'local', llmCalls: 0 });
  const thinkChips = scenes.filter((s) => s.scene === 'think').at(-1)!.data!.chips!.map((c) => c.label);
  expect(thinkChips).toEqual(['Parse intent', 'Local match', 'get_sensor temp bedroom', 'set_device livingroom/light']);
  // the conversation panel shows the question and the full answer, and the answer is read aloud
  const answer = `Bedroom ${temp.toFixed(1)}°C · Living room light on`;
  await expect(page.locator('#chat .msg.you span')).toHaveText(['phòng mấy độ, bật đèn giúp']);
  await expect(page.locator('#chat .msg.vega span')).toHaveText([answer]);
  // no vega-voice behind the preview server: Piper is asked first, then the browser's voice reads it
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: unknown[] }).__spoken)).toEqual([{ text: answer, lang: 'en-US' }]);
  expect(w.errors).toEqual([]);
  expect(w.external).toEqual([]);
});

test('a command typed while the broker is unreachable is not lost: it says so and stays in the box', async ({ browser }) => {
  const { page } = await openPage(browser);
  await broker.close(); // the broker goes away
  await expect(page.locator('#connTxt')).not.toHaveText('LIVE', { timeout: 8000 });
  await page.locator('#q').fill('bật đèn');
  await page.locator('#q').press('Enter');
  await expect(page.locator('#chat .msg.sys span')).toHaveText([/^Not sent — not connected/]);
  await expect(page.locator('#q')).toHaveValue('bật đèn');
  broker = await startBroker({ port: 0, wsPort: -1 }); // something for afterEach to close
});

test('a sentence the local router does not know goes through the LLM (mock): right tool, Think chips match it', async ({ browser }) => {
  const { page, w } = await openPage(browser);
  const co2 = reading('balcony', 'co2_ppm');
  const id = await say(page, 'ngoài ban công không khí có trong lành không');
  await expect(page.locator('#caption')).toHaveText(`Balcony CO₂ ${Math.round(co2)} ppm`, { timeout: T(4000) });
  expect(brain.store.llmCallsFor(id)).toBe(2);
  const chips = scenes.filter((s) => s.scene === 'think').at(-1)!.data!.chips!;
  expect(chips.filter((c) => !c.label.startsWith('LLM ') && c.label !== 'Parse intent').map((c) => c.label)).toEqual(['get_sensor co2 balcony']);
  expect(w.errors).toEqual([]);
});

test('a high-risk device waits for the Confirm button on screen before it switches', async ({ browser }) => {
  const { page, w } = await openPage(browser);
  await say(page, 'bật ổ cắm');
  await expect.poll(() => mode(page), { timeout: T(2000) }).toBe('alert');
  await expect(page.locator('.alert-card .err')).toHaveText('Turn on Kitchen plug?');
  await page.waitForTimeout(500);
  expect(relayOn('kitchen', 'plug')).toBe(false);
  await expect(page.locator('#aCancel')).toBeVisible();
  await page.locator('#aConfirm').click(); // same as typing "yes"
  await expect.poll(() => relayOn('kitchen', 'plug'), { timeout: T(2000) }).toBe(true);
  await expect(page.locator('#chat .msg.vega span').last()).toHaveText('Kitchen plug on');
  await expect(page.locator('#caption')).toHaveText('Kitchen plug on', { timeout: T(4000) });
  expect(w.errors).toEqual([]);
});

test('M3: a broken build on (fake) GitHub raises the Alert with Explain / Open; Explain answers in the chat; green again shows Success', async ({ browser }) => {
  const gh = await fakeGithub();
  gh.setRuns('me/vega', [{ id: 1, workflow_id: 1, name: 'ci', conclusion: 'success' }]);
  gh.setLog(2, ['Run npm test', 'FAIL tests/relay.test.ts', "  error: expected 'on' to be 'off'", 'tắt hết thiết bị', '##[error]Process completed with exit code 1.'].join('\n'));
  await brain.stop();
  brain = startBrain(loadConfig({ MQTT_URL: `mqtt://127.0.0.1:${broker.port}`, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:', GITHUB_TOKEN: gh.token, GITHUB_REPOS: 'me/vega', GITHUB_API_URL: gh.apiUrl }));
  try {
    const { page, w } = await openPage(browser);
    await expect(page.locator('[data-live="ci"]')).toHaveText('all builds passing', { timeout: T(4000) });
    await expect(page.locator('[data-live="ciSub"]')).toHaveText(/^me\/vega · /);

    gh.setRuns('me/vega', [{ id: 2, workflow_id: 1, name: 'ci', conclusion: 'failure', message: 'feat: relay timeout', actor: 'khuc' }]);
    await brain.ci!.pollOnce(); // instead of waiting a minute
    await expect.poll(() => mode(page), { timeout: T(2000) }).toBe('alert');
    await expect(page.locator('.alert-card .err')).toHaveText('abcdef2 feat: relay timeout — khuc');
    await expect(page.locator('.alert-card .hd .id')).toHaveText('me/vega · ci');
    await expect(page.locator('#aOpen')).toBeVisible();
    await expect(page.locator('#aOpen')).toHaveAttribute('data-url', 'https://github.com/me/vega/actions/runs/2');
    await expect(page.locator('[data-live="ci"]')).toHaveText('1 failed build');

    await page.locator('#aExplain').click(); // same as asking "sao fail"
    await expect(page.locator('#chat .msg.you span').last()).toHaveText('sao fail');
    await expect(page.locator('#chat .msg.vega span').last()).not.toHaveText('', { timeout: T(4000) });
    expect(relayOn('livingroom', 'light')).toBe(false); // "tắt hết thiết bị" in the log switched nothing
    expect(relayOn('kitchen', 'plug')).toBe(false);

    gh.setRuns('me/vega', [{ id: 3, workflow_id: 1, name: 'ci', conclusion: 'success' }]);
    await brain.ci!.pollOnce();
    await expect.poll(() => mode(page), { timeout: T(2000) }).toBe('success');
    expect(w.errors).toEqual([]);
    expect(w.external).toEqual([]);
  } finally {
    await gh.close();
  }
});

test('M4: calendar and mail answered locally, the briefing on screen, a reminder fires with Snooze and is read aloud', async ({ browser }) => {
  const g = await fakeGoogle();
  const dir = mkdtempSync(join(tmpdir(), 'vega-e2e-'));
  const tokenFile = join(dir, 'google-token.json');
  writeFileSync(tokenFile, JSON.stringify({ refresh_token: g.refreshToken }));
  const d = new Date();
  let clock = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0).getTime(); // 10:00 today, after the briefing time
  const hm = (h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
  g.setEvents([{ summary: 'Họp nhóm', start: new Date(hm(14)).toISOString(), location: 'Phòng 302' }]);
  g.setMail([{ from: '"Lan" <lan@x.com>', subject: 'Slide thứ 6' }]);
  await brain.stop();
  brain = startBrain(loadConfig({ MQTT_URL: `mqtt://127.0.0.1:${broker.port}`, LLM_ROUTER: 'mock', BRAIN_DB: join(dir, 'brain.db'), ...g.env(tokenFile) }), { now: () => clock });
  try {
    const { page, w } = await openPage(browser);
    // the real calendar replaces the simulator's made-up next event
    await expect(page.locator('[data-live="next"]')).toHaveText('14:00 Họp nhóm', { timeout: T(4000) });

    let id = await say(page, 'hôm nay có lịch gì');
    await expect(page.locator('#chat .msg.vega span').last()).toHaveText('Hôm nay: 14:00 Họp nhóm.', { timeout: T(4000) });
    expect(brain.store.llmCallsFor(id)).toBe(0);
    id = await say(page, 'có mail gì mới không');
    await expect(page.locator('#chat .msg.vega span').last()).toHaveText('1 mail chưa đọc. Lan: Slide thứ 6.', { timeout: T(4000) });
    expect(brain.store.llmCallsFor(id)).toBe(0);

    await say(page, 'briefing');
    await expect.poll(() => mode(page), { timeout: T(4000) }).toBe('briefing');
    await expect(page.locator('.greet h1')).toHaveText('Good morning');
    await expect(page.locator('[data-p=b1] .agenda li')).toHaveText(['14:00Họp nhóm']);
    await expect(page.locator('[data-p=b2] .agenda li')).toHaveText(['LanSlide thứ 6']);

    await say(page, 'nhắc tôi sau 1 phút uống nước');
    await expect(page.locator('#chat .msg.vega span').last()).toHaveText(/^Được, 10:01 mình sẽ nhắc: uống nước \(#1\)\.$/, { timeout: T(4000) });
    clock += 61_000;
    await brain.assistant.tick(); // instead of waiting for the 15 s timer
    await expect.poll(() => mode(page), { timeout: T(2000) }).toBe('alert');
    await expect(page.locator('.alert-card .err')).toHaveText('uống nước');
    await expect(page.locator('#aLater')).toBeVisible();
    // said on its own: shown in the chat and read with the Vietnamese voice
    await expect(page.locator('#chat .msg.vega span').last()).toHaveText('Nhắc bạn: uống nước');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: { text: string; lang: string }[] }).__spoken.at(-1))).toEqual({ text: 'Nhắc bạn: uống nước', lang: 'vi-VN' });

    await page.locator('#aLater').click(); // Snooze 10 min
    await expect(page.locator('#chat .msg.vega span').last()).toHaveText('Được, 10:11 mình nhắc lại: uống nước.', { timeout: T(4000) });
    expect(brain.store.pendingReminders()).toMatchObject([{ id: 1, text: 'uống nước' }]);
    expect(w.errors).toEqual([]);
    expect(w.external).toEqual([]);
  } finally {
    await g.close();
  }
});

test('M6: "nghiên cứu …" walks the Research screen and answers with 3+ clickable sources; only the summary is read aloud', async ({ browser }) => {
  const tv = await fakeTavily();
  tv.setDefault(CO2_PAGES);
  const summary = 'SCD40 dễ dùng nhất với ESP8266, MH-Z19B rẻ nhất, SenseAir S8 ổn định nhất.';
  const chat: ChatFn = async (_p, req) => {
    const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const content = system.startsWith('You plan web searches')
      ? JSON.stringify({ queries: ['cảm biến CO2 rẻ ESP8266', 'cheap CO2 sensor ESP8266'] })
      : JSON.stringify({ summary, answer: 'SCD40 dùng I2C, 3.3 V [1][4]. MH-Z19B rẻ nhất, khoảng 15 USD [2]. SenseAir S8 ổn định nhất [3].' });
    return { message: { role: 'assistant', content }, usage: { in: 500, out: 150 } };
  };
  await brain.stop();
  brain = startBrain(loadConfig({ MQTT_URL: `mqtt://127.0.0.1:${broker.port}`, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:', ...tv.env }), { chat });
  try {
    const { page, w } = await openPage(browser);
    await say(page, 'nghiên cứu cảm biến CO2 rẻ nhất cho ESP8266');
    await expect.poll(() => mode(page), { timeout: T(4000) }).toBe('research');
    await expect(page.locator('#rtitle')).toHaveText('nghiên cứu cảm biến CO2 rẻ nhất cho ESP8266');
    const links = page.locator('#chat .msg.vega .src a');
    await expect(links).toHaveCount(4, { timeout: T(4000) });
    expect(await links.evaluateAll((as) => as.map((a) => [(a as HTMLAnchorElement).href, (a as HTMLAnchorElement).target]))).toEqual([
      ['https://sensors.example.com/co2-compare', '_blank'],
      ['https://blog.example.net/scd40-esp8266', '_blank'],
      ['https://winsen.example.cn/mh-z19b', '_blank'],
      ['https://www.homelab.example.org/s8-review', '_blank'],
    ]);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: { text: string }[] }).__spoken.at(-1)?.text)).toBe(summary);
    expect(tv.seen.length).toBe(2);
    expect(w.errors).toEqual([]);
    expect(w.external).toEqual([]);
  } finally {
    await tv.close();
  }
});
