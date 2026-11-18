import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { benchProvider, loadCases, matches, table } from '../bench/bench';
import { MOCK } from '../src/config';

const cases = loadCases(fileURLToPath(new URL('../bench/cases.jsonl', import.meta.url)));

describe('bench', () => {
  it('has 50 Vietnamese sample commands, each with the expected tools', () => {
    expect(cases).toHaveLength(50);
    for (const c of cases) expect(Array.isArray(c.expect)).toBe(true);
    expect(cases.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(8); // questions that need no tool
  });

  it('matches tools regardless of order; no room means the default room', () => {
    const light = { tool: 'set_device', args: { device: 'livingroom/light', on: true } };
    const temp = { tool: 'get_sensor', args: { metric: 'temp', room: 'bedroom' } };
    expect(matches([light, temp], [{ tool: 'get_sensor', args: { metric: 'temp' } }, light])).toBe(true);
    expect(matches([light], [light, light])).toBe(true);
    expect(matches([light], [{ ...light, args: { ...light.args, on: false } }])).toBe(false);
    expect(matches([], [light])).toBe(false);
    expect(matches([], [])).toBe(true);
  });

  it('runs the mock provider and prints the table', async () => {
    const row = await benchProvider(MOCK, cases);
    expect(row.total).toBe(50);
    expect(row.errors).toBe(0);
    expect(row.correct).toBeGreaterThanOrEqual(45); // the mock is a fixed baseline: a drop means a regression
    expect(row.usdPer100).toBeGreaterThan(0);
    expect(table([row])).toMatch(/^\| provider \| model \| accuracy \| p50 latency \| USD \/ 100 commands \| errors \|\n\|---/);
  });
});
