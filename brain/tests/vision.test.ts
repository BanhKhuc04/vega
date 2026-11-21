import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { readdirSync } from 'node:fs';
import { loadConfig } from '../src/config';
import type { ChatFn } from '../src/agent';
import { chat, LlmUnavailable } from '../src/llm';
import { Store, dayOf } from '../src/store';
import { toolSpecs } from '../src/tools';
import { FrameCache, lastJpeg, parseSeen, visionMessages } from '../src/vision';
import type { Camera } from '../src/vision';
import { voiceServer } from '../src/voice';
import { simRegistry } from '../bench/registry';
import { makeAgent } from './harness';

const JPEG = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

function fakeCamera(opts: { present?: boolean; fail?: boolean } = {}) {
  const cam = { present: opts.present ?? true, shots: 0 };
  const camera: Camera = {
    present: () => cam.present,
    capture: async () => {
      cam.shots++;
      if (opts.fail) throw new Error('VIDIOC_STREAMON: No such device');
      return JPEG;
    },
  };
  return { cam, camera };
}

function visionAgent(opts: { env?: Record<string, string>; present?: boolean; fail?: boolean; chat?: ChatFn } = {}) {
  const { cam, camera } = fakeCamera(opts);
  const frames = new FrameCache();
  const t = makeAgent({ env: { LLM_VISION: 'mock', ...opts.env }, deps: { vision: { camera, frames } }, ...(opts.chat && { chat: opts.chat }) });
  const lastVision = () => t.scenes.filter((s) => s.scene === 'vision').at(-1) as { data?: Record<string, unknown> } | undefined;
  return { ...t, cam, frames, lastVision };
}

describe('parseSeen: the model answer is untrusted', () => {
  it('JSON inside a markdown fence, boxes as fractions', () => {
    const s = parseSeen('```json\n{"summary":"Một cốc","objects":[{"label":"Cốc","box":[0.1,0.2,0.3,0.4]}]}\n```');
    expect(s).toEqual({ summary: 'Một cốc', objects: [{ label: 'Cốc', box: [0.1, 0.2, 0.3, 0.4] }] });
  });
  it('0-1000 boxes are scaled; bad boxes drop only that object', () => {
    const s = parseSeen(JSON.stringify({ summary: 'x', objects: [
      { label: 'a', box: [100, 200, 300, 400] },
      { label: 'outside', box: [0.9, 0.1, 0.5, 0.2] },
      { label: 'negative', box: [-0.1, 0, 0.2, 0.2] },
      { label: 'three', box: [0.1, 0.1, 0.1] },
      { label: '', box: [0.1, 0.1, 0.1, 0.1] },
      { label: 'edge', box: [0.995, 0.5, 0.01, 0.1] },
      'nonsense',
    ] }));
    expect(s!.objects).toEqual([{ label: 'a', box: [0.1, 0.2, 0.3, 0.4] }, { label: 'edge', box: [0.995, 0.5, 0.005, 0.1] }]);
  });
  it('no summary, no answer', () => {
    expect(parseSeen('I see a desk')).toBeNull();
    expect(parseSeen('{"objects":[]}')).toBeNull();
    expect(parseSeen(null)).toBeNull();
  });
});

describe('camera and photo cache', () => {
  it('lastJpeg: the last complete frame of an MJPEG stream', () => {
    const dark = Buffer.from([0xff, 0xd8, 9, 0xff, 0xd9]);
    expect(lastJpeg(Buffer.concat([dark, JPEG]))).toEqual(JPEG);
    expect(lastJpeg(Buffer.concat([dark, JPEG, Buffer.alloc(320, 0xed)]))).toEqual(JPEG); // UVC padding after the end marker
    expect(lastJpeg(Buffer.concat([dark, Buffer.from([0xff, 0xd8, 1, 2])]))).toBeNull(); // cut off
    expect(lastJpeg(Buffer.from('no jpeg here'))).toBeNull();
  });
  it('FrameCache: one photo, behind its id, gone after the TTL or the next photo', () => {
    let now = 0;
    const f = new FrameCache(120_000, () => now);
    const id = f.put(JPEG);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(f.get(id)).toBe(JPEG);
    expect(f.get('wrong-id-1234')).toBeNull();
    const id2 = f.put(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(f.get(id)).toBeNull();
    now = 120_001;
    expect(f.get(id2)).toBeNull();
  });
  it('the photo reaches the model as an image part, the question as part of the instructions', () => {
    const m = visionMessages(JPEG, 'cái cốc màu gì', 'vi');
    expect(m[0]!.content).toContain('cái cốc màu gì');
    expect(m[0]!.content).toContain('Vietnamese');
    expect(m[1]).toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${JPEG.toString('base64')}` } }] });
  });
});

describe('agent: "trên bàn có gì?"', () => {
  it('local command: one photo, one vision call, the Vision scene with the photo and boxes', async () => {
    const t = visionAgent();
    const out = await t.agent.handle({ id: 'v1', text: 'Trên bàn có gì?', origin: 'owner' });
    expect(out.path).toBe('local');
    expect(out.answer).toMatch(/Raspberry Pi/);
    expect([t.cam.shots, t.llm.calls]).toEqual([1, 1]);
    const d = t.lastVision()!.data!;
    expect(d.status).toBe('ok');
    expect(d.frame).toMatch(/^\/vision\/frame\/[\w-]+$/);
    expect(t.frames.get(String(d.frame).split('/').pop()!)).toBe(JPEG);
    expect((d.objects as unknown[]).length).toBe(7);
    expect(t.store.callsOn(dayOf(Date.now()), 'vision')).toBe(1);
    expect(t.usage.at(-1)!.spentUsd).toBeGreaterThan(0); // counted in the daily budget
  });
  it('English works too', async () => {
    const t = visionAgent();
    expect((await t.agent.handle({ id: 'v1', text: "what's on the desk", origin: 'owner' })).path).toBe('local');
    expect(t.cam.shots).toBe(1);
  });
  it('camera unplugged: said plainly, no photo, no AI call', async () => {
    const t = visionAgent({ present: false });
    const out = await t.agent.handle({ id: 'v1', text: 'trên bàn có gì', origin: 'owner' });
    expect(out.answer).toBe('Camera đang rút.');
    expect([t.cam.shots, t.llm.calls]).toEqual([0, 0]);
    expect(t.lastVision()!.data).toMatchObject({ status: 'unplugged' });
  });
  it('the camera fails while taking the photo', async () => {
    const t = visionAgent({ fail: true });
    const out = await t.agent.handle({ id: 'v1', text: 'trên bàn có gì', origin: 'owner' });
    expect(out.answer).toBe('Camera không chụp được ảnh.');
    expect(t.llm.calls).toBe(0);
  });
  it('no vision model: says how to set it up, takes no photo', async () => {
    const t = visionAgent({ env: { LLM_VISION: '' } });
    const out = await t.agent.handle({ id: 'v1', text: 'trên bàn có gì', origin: 'owner' });
    expect(out.answer).toMatch(/LLM_VISION/);
    expect(t.cam.shots).toBe(0);
    expect(t.lastVision()!.data).toMatchObject({ status: 'off' });
  });
  it('VISION_MAX_DAY: no photo once the day is used up', async () => {
    const t = visionAgent({ env: { VISION_MAX_DAY: '1' } });
    await t.agent.handle({ id: 'v1', text: 'trên bàn có gì', origin: 'owner' });
    const out = await t.agent.handle({ id: 'v2', text: 'trên bàn có gì', origin: 'owner' });
    expect(out.answer).toMatch(/1 lần/);
    expect(t.cam.shots).toBe(1);
  });
  it('model offline: the photo is still shown, the answer says why', async () => {
    const t = visionAgent({ chat: async () => { throw new LlmUnavailable('offline', 'fetch failed'); } });
    const out = await t.agent.handle({ id: 'v1', text: 'trên bàn có gì', origin: 'owner' });
    expect(out.answer).toMatch(/Mất mạng/);
    expect(t.lastVision()!.data).toMatchObject({ status: 'offline' });
    expect(t.lastVision()!.data!.frame).toBeDefined();
  });
  it('an unreadable model answer never breaks the scene', async () => {
    const t = visionAgent({ chat: async () => ({ message: { role: 'assistant', content: 'a desk, I think' }, usage: { in: 10, out: 5 } }) });
    const out = await t.agent.handle({ id: 'v1', text: 'trên bàn có gì', origin: 'owner' });
    expect(out.answer).toMatch(/không đúng dạng/);
    expect(t.lastVision()!.data).toMatchObject({ status: 'ok' });
  });
  it('the LLM can look with a question; what the model saw comes back as outside content', async () => {
    const seen: unknown[] = [];
    const llm: ChatFn = async (p, req, o) => {
      seen.push(req);
      const tools = req.tools?.map((x) => x.function.name) ?? [];
      if (req.messages.some((m) => m.role === 'user' && Array.isArray(m.content))) return chat(p, req, o); // the vision call: mock
      if (req.messages.at(-1)!.role === 'user') {
        expect(tools).toContain('look');
        return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look', arguments: '{"question":"cái cốc màu gì"}' } }] }, usage: { in: 1, out: 1 } };
      }
      const tool = req.messages.at(-1) as { content: string };
      expect(tool.content).toContain('<external source=\\"camera\\">');
      return { message: { role: 'assistant', content: 'Cốc màu trắng.' }, usage: { in: 1, out: 1 } };
    };
    const t = visionAgent({ chat: llm });
    const out = await t.agent.handle({ id: 'v1', text: 'cái cốc trên bàn màu gì?', origin: 'owner' });
    expect(out.answer).toBe('Cốc màu trắng.');
    expect(t.cam.shots).toBe(1);
  });
  it('the camera is never offered with outside content in play', () => {
    const reg = simRegistry();
    expect(toolSpecs(reg, { camera: true }).map((s) => s.function.name)).toContain('look');
    expect(toolSpecs(reg, { camera: true, physical: false }).map((s) => s.function.name)).not.toContain('look');
    expect(toolSpecs(reg, {}).map((s) => s.function.name)).not.toContain('look');
  });
});

describe('/vision/frame/<id>', () => {
  let srv: Server | null = null;
  afterEach(() => void srv?.close());
  it('serves the photo from memory, 404 for any other id; nothing is written to disk', async () => {
    const before = readdirSync('.').sort();
    const frames = new FrameCache();
    const id = frames.put(JPEG);
    srv = voiceServer({ config: loadConfig({ BRAIN_DB: ':memory:' }), store: new Store(':memory:'), log: () => {}, onSpent: () => {}, frames });
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/vision/frame/`;
    const r = await fetch(base + id);
    expect([r.status, r.headers.get('content-type'), r.headers.get('cache-control')]).toEqual([200, 'image/jpeg', 'no-store']);
    expect(Buffer.from(await r.arrayBuffer())).toEqual(JPEG);
    expect((await fetch(`${base}not-the-id-1234`)).status).toBe(404);
    expect((await fetch(`${base}..%2f..%2fetc`)).status).toBe(404);
    expect(readdirSync('.').sort()).toEqual(before);
  });
});
