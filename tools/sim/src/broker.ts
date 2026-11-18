import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import type { Server as NetServer } from 'node:net';
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

export interface BrokerOptions {
  /** TCP MQTT port; 0 = pick a free one, -1 = no TCP listener. */
  port?: number;
  /** MQTT-over-WebSocket port (what the dashboard uses); 0 = free port, -1 = none. */
  wsPort?: number;
  host?: string;
}

export interface Broker {
  port: number;
  wsPort: number;
  /** Closes listeners and drops every client, like a broker that was switched off. */
  close(): Promise<void>;
}

/**
 * In-process MQTT broker (aedes) with an anonymous WebSocket listener. For development and CI only:
 * no authentication, no TLS, no persistence. It lets e2e tests run without Docker or a Mosquitto binary.
 */
export async function startBroker(opts: BrokerOptions = {}): Promise<Broker> {
  const host = opts.host ?? '127.0.0.1';
  const aedes = await Aedes.createBroker();
  const closers: (() => Promise<void>)[] = [];
  let port = -1;
  let wsPort = -1;

  if (opts.port !== -1) {
    const net: NetServer = createNetServer(aedes.handle);
    await new Promise<void>((res, rej) => net.once('error', rej).listen(opts.port ?? 0, host, res));
    port = (net.address() as { port: number }).port;
    const sockets = new Set<import('node:net').Socket>();
    net.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    closers.push(
      () =>
        new Promise<void>((res) => {
          for (const s of sockets) s.destroy();
          net.close(() => res());
        }),
    );
  }

  if (opts.wsPort !== -1) {
    const http: HttpServer = createHttpServer();
    const wss = new WebSocketServer({ server: http, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });
    wss.on('connection', (ws, req) => {
      const stream = createWebSocketStream(ws);
      stream.on('error', () => {});
      aedes.handle(stream, req);
    });
    await new Promise<void>((res, rej) => http.once('error', rej).listen(opts.wsPort ?? 0, host, res));
    wsPort = (http.address() as { port: number }).port;
    closers.push(
      () =>
        new Promise<void>((res) => {
          for (const c of wss.clients) c.terminate();
          wss.close();
          http.close(() => res());
        }),
    );
  }

  return {
    port,
    wsPort,
    async close() {
      for (const c of closers) await c();
      await new Promise<void>((res) => aedes.close(() => res()));
    },
  };
}
