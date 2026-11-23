import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { SYSTEM_COMMAND, deviceTopic } from '@vega/contract';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import type { Sim } from '../../tools/sim/src/simlib';
import { loadConfig } from '../src/config';
import { startBrain } from '../src/service';
import type { Brain } from '../src/service';
import { fakeStt } from './fakestt';

/**
 * M5.2 integration: the real pc-agent (Python, openWakeWord "hey jarvis") reads a WAV instead of the microphone —
 * Piper saying "Hey Jarvis! … Bật đèn phòng khách." — against an in-process broker, simulator and brain with a fake STT.
 * Needs Python with pc-agent/requirements.txt: set PC_AGENT_PYTHON (CI does); skipped otherwise.
 */
const PY = process.env.PC_AGENT_PYTHON;
const agentDir = fileURLToPath(new URL('../../pc-agent/', import.meta.url));

describe.skipIf(!PY)('pc-agent end to end (WAV in place of the mic)', () => {
  let broker: Broker;
  let sim: Sim;
  let brain: Brain;
  let spy: MqttClient;
  let stt: Awaited<ReturnType<typeof fakeStt>>;
  const seen: { topic: string; body: string }[] = [];

  beforeAll(async () => {
    broker = await startBroker({ port: 0, wsPort: -1 });
    const url = `mqtt://127.0.0.1:${broker.port}`;
    spy = mqtt.connect(url, { reconnectPeriod: 0 });
    await new Promise<void>((r) => spy.once('connect', () => r()));
    spy.on('message', (topic, p) => seen.push({ topic, body: p.toString() }));
    await spy.subscribeAsync(['vega/#']);
    sim = await runSim({ url, intervalMs: 60_000, piIntervalMs: 60_000 });
    stt = await fakeStt({ text: 'Bật đèn phòng khách.', duration: 2.1 });
    brain = startBrain(loadConfig({ MQTT_URL: url, BRAIN_DB: ':memory:', VOICE_PORT: '0', ...stt.env }));
  });

  afterAll(async () => {
    await brain?.stop();
    await sim?.stop();
    spy?.end(true);
    await stt?.close();
    await broker?.close();
  });

  it('wake word → recorded command → brain STT → command via voice → the relay switches → exit 0', async () => {
    const port = await brain.voicePort;
    const out: string[] = [];
    const code = await new Promise<number | null>((resolve) => {
      const p = spawn(PY!, ['main.py', '--wav', 'fixtures/hey-jarvis-bat-den.wav'], {
        cwd: agentDir,
        env: { ...process.env, MQTT_URL: `mqtt://127.0.0.1:${broker.port}`, VEGA_STT_URL: `http://127.0.0.1:${port}/voice/stt`, VEGA_TTS_URL: '', HOTKEY: '' },
      });
      p.stdout.on('data', (d: Buffer) => out.push(d.toString()));
      p.stderr.on('data', (d: Buffer) => out.push(d.toString()));
      p.on('close', resolve);
    });
    const log = out.join('');
    expect(code, log).toBe(0);
    expect(log).toContain('heard: Bật đèn phòng khách.');
    expect(log).toContain('VEGAS: Living room light on');
    // the agent never sent the wake word itself, only the command: about 2 s of audio, not the whole 5.3 s file
    expect(stt.seen).toHaveLength(1);
    expect(stt.seen[0]!.bytes).toBeLessThan(16000 * 2 * 4);
    const command = seen.find((m) => m.topic === SYSTEM_COMMAND)!;
    expect(JSON.parse(command.body)).toMatchObject({ v: 1, text: 'Bật đèn phòng khách.', via: 'voice' });
    expect(JSON.parse(seen.filter((m) => m.topic === deviceTopic('livingroom', 'light', 'state')).at(-1)!.body).on).toBe(true);
    // the screen saw the agent's states, and its mic as on
    // (the simulator's own ESP "desk/core" also reports here, without a mic field)
    const states = seen.filter((m) => m.topic === 'vega/desk/core/state').map((m) => JSON.parse(m.body) as { state: string; mic?: string }).filter((s) => s.mic);
    expect(states.map((s) => s.state)).toEqual(expect.arrayContaining(['listening', 'thinking', 'speaking']));
    expect(states.every((s) => s.mic === 'on')).toBe(true);
  }, 60_000);
});
