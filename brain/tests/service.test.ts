import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { SYSTEM_COMMAND, deviceTopic, eventTopic } from '@vega/contract';
import { startBroker } from '../../tools/sim/src/broker';
import type { Broker } from '../../tools/sim/src/broker';
import { runSim } from '../../tools/sim/src/simlib';
import type { Sim } from '../../tools/sim/src/simlib';
import { loadConfig } from '../src/config';
import { startBrain } from '../src/service';
import type { Brain } from '../src/service';

const wait = async (cond: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('brain service over a real (in-process) broker with the simulator', () => {
  let broker: Broker;
  let sim: Sim;
  let brain: Brain;
  let spy: MqttClient;
  const last = new Map<string, string>();
  const cmd = (id: string, text: string, opts: { ts?: string; retain?: boolean } = {}) =>
    spy.publish(SYSTEM_COMMAND, JSON.stringify({ v: 1, id, text, ts: opts.ts ?? new Date().toISOString() }), { retain: opts.retain ?? false });
  const result = () => last.get(eventTopic('command_result'));

  beforeEach(async () => {
    last.clear();
    broker = await startBroker({ port: 0, wsPort: -1 });
    const url = `mqtt://127.0.0.1:${broker.port}`;
    spy = mqtt.connect(url, { reconnectPeriod: 0 });
    await new Promise<void>((r) => spy.once('connect', () => r()));
    spy.on('message', (t, p) => last.set(t, p.toString()));
    await spy.subscribeAsync(['vega/#']);
    sim = await runSim({ url, intervalMs: 60_000, piIntervalMs: 60_000 }); // one reading each: stable values
    brain = startBrain(loadConfig({ MQTT_URL: url, LLM_ROUTER: 'mock', BRAIN_DB: ':memory:' }));
    await wait(() => brain.registry.switches().length === 2 && brain.registry.sensors('temp', 'bedroom').length === 1);
  });
  afterEach(async () => {
    await brain.stop();
    await sim.stop();
    spy.end(true);
    await broker.close();
  });

  it('"phòng mấy độ, bật đèn giúp": the sim temperature, the virtual relay on, no LLM call in the ledger', async () => {
    const temp = JSON.parse(last.get(deviceTopic('bedroom', 'env', 'state'))!).temp_c as number;
    cmd('UI-1', 'phòng mấy độ, bật đèn giúp');
    await wait(() => !!result());
    expect(JSON.parse(result()!)).toMatchObject({ type: 'command_result', id: 'UI-1', result: `Bedroom ${temp.toFixed(1)}°C · Living room light on` });
    await wait(() => JSON.parse(last.get(deviceTopic('livingroom', 'light', 'state'))!).on === true);
    expect(brain.store.llmCallsFor('UI-1')).toBe(0);
    expect(brain.store.lastCommands(1)[0]).toMatchObject({ id: 'UI-1', path: 'local', llmCalls: 0 });
  });

  it('ignores retained, stale and malformed commands', async () => {
    cmd('OLD-1', 'bật đèn', { ts: new Date(Date.now() - 5 * 60_000).toISOString() });
    cmd('RET-1', 'bật đèn', { retain: true });
    spy.publish(SYSTEM_COMMAND, '{nope');
    spy.publish(SYSTEM_COMMAND, JSON.stringify({ v: 1, text: 'bật đèn' }));
    cmd('NOW-1', 'phòng mấy độ'); // processed after the others: when it is answered, they were already dropped
    await wait(() => !!result() && JSON.parse(result()!).id === 'NOW-1');
    await brain.idle();
    expect(brain.store.lastCommands().map((c) => c.id)).toEqual(['NOW-1']);
    expect(JSON.parse(last.get(deviceTopic('livingroom', 'light', 'state'))!).on).toBe(false);
    spy.publish(SYSTEM_COMMAND, '', { retain: true }); // clear the retained test command
  });
});
