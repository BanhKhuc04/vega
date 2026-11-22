import { describe, expect, it } from 'vitest';
import { createDataSource } from '../src/data/datasource';

const kind = (env: object, search = '', cfg = {}, host = 'pi.local') => createDataSource(env, search, cfg, host).kind;

describe('createDataSource', () => {
  it('defaults to SIM (mock)', () => expect(kind({})).toBe('mock'));
  it('build-time env, runtime config and URL, in increasing priority', () => {
    expect(kind({ VITE_DATA_SOURCE: 'mqtt' })).toBe('mqtt');
    expect(kind({ VITE_DATA_SOURCE: 'mqtt' }, '', { source: 'mock' })).toBe('mock');
    expect(kind({ VITE_DATA_SOURCE: 'mock' }, '', { source: 'mock' }, 'x')).toBe('mock');
    expect(kind({}, '?source=mqtt', { source: 'mock' })).toBe('mqtt');
    expect(kind({ VITE_DATA_SOURCE: 'mqtt' }, '?source=mock')).toBe('mock');
  });
  it('unknown source names fall back to SIM', () => expect(kind({}, '?source=carrier-pigeon')).toBe('mock'));
  it('the MQTT URL defaults to the WebSocket port of the host that served the page', () => {
    const src = createDataSource({}, '?source=mqtt', {}, 'pi.local') as unknown as { opts: { url: string } };
    expect(src.opts.url).toBe('ws://pi.local:9001');
  });
  it('MQTT URL, credentials and room come from the URL / runtime config', () => {
    const src = createDataSource({ VITE_MQTT_URL: 'ws://env:1' }, '?source=mqtt&mqtt=ws://url:2', { username: 'ui', password: 'secret', room: 'office' }, 'h') as unknown as {
      opts: { url: string; username: string; password: string; primaryRoom: string };
    };
    expect(src.opts).toMatchObject({ url: 'ws://url:2', username: 'ui', password: 'secret', primaryRoom: 'office' });
    const https = createDataSource({}, '?source=mqtt', {}, 'vega.tail1234.ts.net', { https: true, host: 'vega.tail1234.ts.net' }) as unknown as { opts: { url: string } };
    expect(https.opts.url).toBe('wss://vega.tail1234.ts.net/mqtt'); // a secure page: same address, through nginx
    // the Pi's config.js says /mqtt: same host and port as the page (a plain-http Tailscale address included)
    const path = createDataSource({}, '?source=mqtt', { mqttUrl: '/mqtt' }, '100.87.86.18', { https: false, host: '100.87.86.18:8080' }) as unknown as { opts: { url: string } };
    expect(path.opts.url).toBe('ws://100.87.86.18:8080/mqtt');
    const cfg = createDataSource({ VITE_MQTT_URL: 'ws://env:1' }, '?source=mqtt', {}, 'h') as unknown as { opts: { url: string } };
    expect(cfg.opts.url).toBe('ws://env:1');
  });
});
