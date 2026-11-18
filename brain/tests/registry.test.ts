import { describe, expect, it } from 'vitest';
import { Registry, label, needsConfirm, roomLabel } from '../src/registry';
import { simRegistry } from './fixtures';

describe('Registry', () => {
  it('builds devices from meta, availability and state', () => {
    const r = simRegistry({ temp: 26.9 });
    expect(r.all()).toHaveLength(6);
    expect(r.switches().map((d) => d.key)).toEqual(['kitchen/plug', 'livingroom/light']);
    expect(r.sensors('temp', 'bedroom').map((d) => d.tempC)).toEqual([26.9]);
    expect(r.sensors('co2').map((d) => d.key)).toEqual(['balcony/env', 'bedroom/env']);
    expect(r.rooms()).toContain('kitchen');
    expect(label(r.get('livingroom/light')!)).toBe('Living room light');
    expect(roomLabel(r, 'bedroom')).toBe('Bedroom');
  });

  it('follows availability and state changes', () => {
    const r = simRegistry();
    r.apply('vega/livingroom/light/availability', 'offline');
    expect(r.get('livingroom/light')!.online).toBe(false);
    r.apply('vega/livingroom/light/state', JSON.stringify({ v: 1, on: true }));
    expect(r.get('livingroom/light')).toMatchObject({ online: true, on: true });
  });

  it('ignores what is not a device message, or breaks the contract', () => {
    const r = new Registry();
    expect(r.apply('vega/system/pi', JSON.stringify({ v: 1, cpu_pct: 3 }))).toBe(false);
    expect(r.apply('vega/x/y/state', '{bad')).toBe(false);
    expect(r.apply('vega/x/y/meta', JSON.stringify({ v: 1, kind: 'esp8266', risk: 'whatever' }))).toBe(false);
    expect(r.all()).toEqual([]);
  });

  it('a switch is low risk only when it says so', () => {
    const r = simRegistry();
    expect(needsConfirm(r.get('livingroom/light')!)).toBe(false);
    expect(needsConfirm(r.get('kitchen/plug')!)).toBe(true);
    r.apply('vega/garage/door/state', JSON.stringify({ v: 1, on: false })); // no meta at all
    expect(needsConfirm(r.get('garage/door')!)).toBe(true);
  });
});
