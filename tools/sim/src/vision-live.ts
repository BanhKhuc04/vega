/**
 * A stand-in for vega-vision on a PC (`npm run vega`, M7.1): /vision/live streams the sample photo as MJPEG and
 * /vision/live/objects sends YOLO-like boxes that drift a little, so the Vision screen's live mode can be tried.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

const OBJECTS = [
  { label: 'Cốc', box: [0.76, 0.59, 0.15, 0.23], conf: 0.91 },
  { label: 'Sách', box: [0.85, 0.03, 0.15, 0.21], conf: 0.72 },
  { label: 'Laptop', box: [0.36, 0.33, 0.29, 0.33], conf: 0.55 },
];

export function startVisionLive(photoPath: string, port = 0): Promise<{ server: Server; port: number }> {
  const jpeg = readFileSync(photoPath);
  const server = createServer((req, res) => {
    const timers: ReturnType<typeof setInterval>[] = [];
    req.on('close', () => timers.forEach(clearInterval));
    if (req.url === '/vision/live') {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store' });
      const send = () => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg, Buffer.from('\r\n')]));
      send();
      timers.push(setInterval(send, 500));
    } else if (req.url === '/vision/live/objects') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const t0 = Date.now();
      const send = () => {
        const dx = Math.sin((Date.now() - t0) / 1500) * 0.03;
        const objects = OBJECTS.map((o) => ({ ...o, box: [Math.max(0, Math.min(o.box[0]! + dx, 1 - o.box[2]!)), o.box[1], o.box[2], o.box[3]] }));
        res.write(`data: ${JSON.stringify({ status: 'live', fps: 4, objects })}\n\n`);
      };
      send();
      timers.push(setInterval(send, 250));
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })));
}
