// Full-screen simulated overhead camera: painted desk scene, detections with leader-line callouts,
// and an "inspect" pass that zooms into the Raspberry Pi 3 and labels its parts.
const W = 1920, H = 1080, RES = 2;
const LIVE_URL = '/vision/live'; // vega-vision, through nginx (M7.1)
const PI = { x: 705, y: 372, k: 6 }; // Pi origin (px) and px per mm
const mm = (x, y) => [PI.x + x * PI.k, PI.y + y * PI.k];
const mmBox = (x0, y0, x1, y1) => { const [a, b] = mm(x0, y0), [c, d] = mm(x1, y1); return [a, b, c - a, d - b]; };

export const OBJECTS = [
  { id: 'pi', name: 'Raspberry Pi 3 Model B', conf: 0.98, box: [PI.x - 6, PI.y - 8, 85 * PI.k + 30, 56 * PI.k + 20], sub: 'Single-board computer · matched to vega-core host', card: [760, 300, 'r'], hero: true },
  { id: 'esp1', name: 'ESP8266 NodeMCU', conf: 0.94, box: [338, 262, 300, 160], sub: 'On breadboard · node env-01 · online', card: [350, 165, 'r'] },
  { id: 'bb', name: 'Breadboard', conf: 0.88, box: [300, 228, 380, 300], sub: '830 tie-points · 5 jumpers to Pi GPIO', card: [120, 610, 'r'] },
  { id: 'esp2', name: 'ESP8266 NodeMCU', conf: 0.92, box: [352, 742, 300, 162], sub: 'Loose · node relay-02 · flashing', card: [690, 965, 'r'] },
  { id: 'relay', name: 'Relay module · 2 channel', conf: 0.9, box: [1330, 300, 300, 230], sub: 'SRD-05VDC · contacts rated 10 A 250 VAC', card: [1340, 590, 'r'] },
  { id: 'mug', name: 'Coffee mug', conf: 0.95, box: [1460, 640, 280, 250], sub: 'Top view · half full', card: [1420, 950, 'r'] },
  { id: 'note', name: 'Notebook', conf: 0.86, box: [1640, 30, 300, 230], sub: 'Handwritten pin map', card: [1600, 205, 'l'] }
];

export const PARTS = [
  { id: 'soc', name: 'SoC · Broadcom BCM2837', sub: '4× Cortex-A53 @ 1.2 GHz', box: mmBox(15, 25, 29, 39), off: [-270, -30] },
  { id: 'wifi', name: 'Wireless', sub: '802.11n Wi-Fi + Bluetooth 4.1', box: mmBox(1, 43, 8, 50), off: [-250, 70] },
  { id: 'pwr', name: 'Power · micro-USB', sub: '5 V 2.5 A · cable connected', box: mmBox(6, 51, 14, 57.5), off: [-200, 150] },
  { id: 'gpio', name: 'GPIO · 40-pin header', sub: '5 jumpers detected', box: mmBox(7, 0.8, 58, 6.2), off: [-120, -110] },
  { id: 'hdmi', name: 'HDMI · full size', sub: 'no display attached', box: mmBox(24.5, 49, 39.5, 57.5), off: [60, 150] },
  { id: 'lan', name: 'USB / LAN controller', sub: 'SMSC LAN9514', box: mmBox(54, 34, 63, 43), off: [70, 190] },
  { id: 'usb', name: 'USB · 4× USB 2.0', sub: '0 devices', box: mmBox(68, 2, 87.5, 34), off: [170, -90] },
  { id: 'eth', name: 'Ethernet · 10/100 Mbit', sub: 'link up · cable connected', box: mmBox(66, 38, 87.5, 54), off: [180, 70] }
];

/* ---------------- scene painting (top-down, at 2× for zoom) ---------------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function shadow(g, fn, blur = 18, ox = 10, oy = 14) { g.save(); g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = blur; g.shadowOffsetX = ox; g.shadowOffsetY = oy; fn(); g.restore(); }
function wire(g, pts, col, w = 6) {
  g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = w + 2; g.beginPath(); g.moveTo(pts[0] + 6, pts[1] + 8);
  g.bezierCurveTo(pts[2] + 6, pts[3] + 8, pts[4] + 6, pts[5] + 8, pts[6] + 6, pts[7] + 8); g.stroke();
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(pts[0], pts[1]); g.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = w * 0.3; g.stroke(); g.restore();
}
function nodemcu(g, x, y, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  shadow(g, () => { g.fillStyle = '#16191d'; rr(g, 0, 0, 294, 156, 8); g.fill(); });
  g.fillStyle = '#1b1f24'; rr(g, 0, 0, 294, 156, 8); g.fill();
  g.fillStyle = '#c9a646'; for (let i = 0; i < 15; i++) { g.beginPath(); g.arc(22 + i * 17.5, 12, 4, 0, 7); g.fill(); g.beginPath(); g.arc(22 + i * 17.5, 144, 4, 0, 7); g.fill(); }
  g.fillStyle = '#0d0f12'; for (let i = 0; i < 15; i++) { g.beginPath(); g.arc(22 + i * 17.5, 12, 1.6, 0, 7); g.fill(); g.beginPath(); g.arc(22 + i * 17.5, 144, 1.6, 0, 7); g.fill(); }
  // ESP-12E module with shield
  g.fillStyle = '#20252b'; g.fillRect(150, 30, 136, 96);
  const sg = g.createLinearGradient(160, 36, 270, 120); sg.addColorStop(0, '#dfe3e8'); sg.addColorStop(1, '#8e969f');
  g.fillStyle = sg; g.fillRect(158, 40, 92, 78);
  g.fillStyle = '#5b6168'; g.font = 'bold 9px sans-serif'; g.fillText('ESP8266MOD', 168, 70); g.font = '7px sans-serif'; g.fillText('VENDOR · ISM 2.4GHz', 168, 84);
  g.strokeStyle = '#c9a646'; g.lineWidth = 2; g.beginPath(); g.moveTo(256, 44); for (let i = 0; i < 6; i++) g.lineTo(256 + (i % 2 ? 22 : 0), 48 + i * 12); g.stroke();
  // usb + buttons + chip
  g.fillStyle = '#b8bec6'; g.fillRect(-6, 62, 26, 32); g.fillStyle = '#2a2f36'; g.fillRect(40, 54, 34, 30); g.fillRect(84, 66, 20, 20);
  g.fillStyle = '#3a3f46'; g.fillRect(30, 104, 18, 14); g.fillRect(30, 36, 18, 14);
  g.fillStyle = '#4fa8ff'; g.beginPath(); g.arc(120, 118, 3, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '8px sans-serif'; g.fillText('NodeMCU v3', 50, 110);
  g.restore();
}
function paint() {
  const c = document.createElement('canvas'); c.width = W * RES; c.height = H * RES;
  const g = c.getContext('2d'); g.scale(RES, RES);
  // walnut desk
  let gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3a2a20'); gr.addColorStop(1, '#1c140f');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 140; i++) {
    const y = rnd() * H, a = 0.03 + rnd() * 0.06;
    g.strokeStyle = rnd() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,220,180,${a * 0.5})`; g.lineWidth = 1 + rnd() * 3;
    g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 120) g.lineTo(x, y + Math.sin(x * 0.004 + i) * 10 + rnd() * 3); g.stroke();
  }
  // cutting mat
  shadow(g, () => { g.fillStyle = '#1d2226'; rr(g, 230, 150, 1500, 860, 18); g.fill(); }, 30, 0, 16);
  g.fillStyle = '#1f2529'; rr(g, 230, 150, 1500, 860, 18); g.fill();
  g.save(); rr(g, 230, 150, 1500, 860, 18); g.clip();
  for (let x = 250; x < 1730; x += 30) { g.strokeStyle = (x - 250) % 150 === 0 ? 'rgba(160,190,200,0.16)' : 'rgba(160,190,200,0.06)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 150); g.lineTo(x, 1010); g.stroke(); }
  for (let y = 170; y < 1010; y += 30) { g.strokeStyle = (y - 170) % 150 === 0 ? 'rgba(160,190,200,0.16)' : 'rgba(160,190,200,0.06)'; g.beginPath(); g.moveTo(230, y); g.lineTo(1730, y); g.stroke(); }
  g.fillStyle = 'rgba(160,190,200,0.25)'; g.font = '11px monospace'; for (let i = 0; i < 10; i++) g.fillText(String(i * 5), 252 + i * 150, 166);
  g.restore();

  // notebook (top-right, partly off the mat)
  g.save(); g.translate(1660, 40); g.rotate(0.08);
  shadow(g, () => { g.fillStyle = '#e9e4d8'; g.fillRect(0, 0, 290, 220); });
  g.fillStyle = '#ece7db'; g.fillRect(0, 0, 290, 220);
  g.strokeStyle = 'rgba(80,110,160,0.35)'; g.lineWidth = 1; for (let y = 30; y < 220; y += 18) { g.beginPath(); g.moveTo(0, y); g.lineTo(290, y); g.stroke(); }
  g.strokeStyle = 'rgba(30,40,70,0.7)'; g.lineWidth = 1.5;
  for (let r = 0; r < 8; r++) { g.beginPath(); g.moveTo(24, 44 + r * 18); for (let x = 24; x < 120 + (r * 23) % 110; x += 9) g.lineTo(x, 44 + r * 18 - (x % 18 < 9 ? 3 : 0)); g.stroke(); }
  g.fillStyle = '#c33'; g.fillRect(-4, 0, 8, 220);
  g.restore();

  // breadboard
  shadow(g, () => { g.fillStyle = '#eceff1'; rr(g, 300, 228, 380, 300, 6); g.fill(); });
  g.fillStyle = '#eef1f3'; rr(g, 300, 228, 380, 300, 6); g.fill();
  g.fillStyle = '#d9dee2'; g.fillRect(300, 370, 380, 16);
  g.strokeStyle = '#d33'; g.lineWidth = 2; g.beginPath(); g.moveTo(312, 240); g.lineTo(668, 240); g.moveTo(312, 516); g.lineTo(668, 516); g.stroke();
  g.strokeStyle = '#36c'; g.beginPath(); g.moveTo(312, 262); g.lineTo(668, 262); g.moveTo(312, 494); g.lineTo(668, 494); g.stroke();
  g.fillStyle = '#7c868e'; for (let x = 316; x < 668; x += 11.2) { for (let y of [248, 256, 500, 508]) g.fillRect(x, y, 3, 3); for (let y = 278; y < 366; y += 11.2) g.fillRect(x, y, 3, 3); for (let y = 394; y < 486; y += 11.2) g.fillRect(x, y, 3, 3); }
  nodemcu(g, 342, 266, 0);
  // loose nodemcu
  nodemcu(g, 360, 744, -0.05);

  // relay module
  g.save(); g.translate(1340, 306); g.rotate(0.04);
  shadow(g, () => { g.fillStyle = '#1a6a3b'; rr(g, 0, 0, 290, 220, 8); g.fill(); });
  g.fillStyle = '#1b6e3d'; rr(g, 0, 0, 290, 220, 8); g.fill();
  for (let i = 0; i < 2; i++) {
    const rg = g.createLinearGradient(0, 20, 0, 140); rg.addColorStop(0, '#2c7cf0'); rg.addColorStop(1, '#1650c4');
    g.fillStyle = rg; rr(g, 26 + i * 130, 20, 110, 120, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 11px sans-serif'; g.fillText('SONGLE', 48 + i * 130, 60); g.font = '9px sans-serif'; g.fillText('SRD-05VDC-SL-C', 36 + i * 130, 78); g.fillText('10A 250VAC', 46 + i * 130, 94);
    g.fillStyle = '#2d78e0'; g.fillRect(36 + i * 130, 160, 90, 40);
    g.fillStyle = '#c8cdd2'; for (let s = 0; s < 3; s++) { g.beginPath(); g.arc(52 + s * 30 + i * 130, 180, 9, 0, 7); g.fill(); }
    g.fillStyle = '#666c73'; for (let s = 0; s < 3; s++) g.fillRect(48 + s * 30 + i * 130, 178, 8, 3);
  }
  g.fillStyle = '#c9a646'; for (let s = 0; s < 4; s++) g.fillRect(-10, 70 + s * 22, 22, 6);
  g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(270, 150, 4, 0, 7); g.fill();
  g.restore();

  // cables (under the Pi)
  wire(g, [PI.x + 60, PI.y + 340, PI.x + 60, PI.y + 520, PI.x - 200, PI.y + 560, PI.x - 260, H + 40], '#111317', 16); // power
  wire(g, [PI.x + 520, PI.y + 275, PI.x + 700, PI.y + 280, PI.x + 760, PI.y + 520, PI.x + 920, H + 40], '#2f6fd6', 14); // ethernet
  const jcol = ['#e8463b', '#f0a92a', '#2fbf71', '#3b82f6', '#e5e7eb'];
  jcol.forEach((col, i) => wire(g, [PI.x + 70 + i * 36, PI.y + 14, PI.x + 40 + i * 30, PI.y - 120, 560 + i * 16, 620, 520 + i * 22, 470], col, 5));

  // Raspberry Pi 3 Model B (85 × 56 mm)
  const [bx, by] = mm(0, 0), bw = 85 * PI.k, bh = 56 * PI.k;
  shadow(g, () => { g.fillStyle = '#1c7a3c'; rr(g, bx, by, bw, bh, 18); g.fill(); }, 26, 12, 18);
  const pg = g.createLinearGradient(bx, by, bx + bw, by + bh); pg.addColorStop(0, '#24914a'); pg.addColorStop(1, '#16672f');
  g.fillStyle = pg; rr(g, bx, by, bw, bh, 18); g.fill();
  g.strokeStyle = 'rgba(150,230,170,0.18)'; g.lineWidth = 1.2;
  for (let i = 0; i < 40; i++) { const x = bx + 40 + rnd() * (bw - 160), y = by + 50 + rnd() * (bh - 110); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 120, y); g.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 80); g.stroke(); }
  // mounting holes
  [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => { const [hx, hy] = mm(x, y); g.fillStyle = '#d6b65a'; g.beginPath(); g.arc(hx, hy, 18, 0, 7); g.fill(); g.fillStyle = '#2a1f17'; g.beginPath(); g.arc(hx, hy, 9, 0, 7); g.fill(); });
  // GPIO header
  let [x, y, w, h] = mmBox(7.1, 1, 57.9, 6.1);
  g.fillStyle = '#111'; g.fillRect(x, y, w, h);
  g.fillStyle = '#e2c26a'; for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) { g.fillRect(x + 8 + i * 15.24, y + 6 + j * 15.24, 6, 6); }
  // SoC
  [x, y, w, h] = mmBox(15, 25, 29, 39);
  const sg = g.createLinearGradient(x, y, x + w, y + h); sg.addColorStop(0, '#e5e8ec'); sg.addColorStop(1, '#9aa1a9');
  g.fillStyle = sg; g.fillRect(x, y, w, h);
  g.fillStyle = '#4b5158'; g.font = 'bold 13px sans-serif'; g.fillText('BROADCOM', x + 10, y + 34); g.font = '11px sans-serif'; g.fillText('BCM2837RIFBG', x + 8, y + 52); g.fillText('© 2012', x + 10, y + 68);
  // LAN chip
  [x, y, w, h] = mmBox(54, 34, 63, 43); g.fillStyle = '#16191d'; g.fillRect(x, y, w, h); g.fillStyle = '#7a828a'; g.font = '8px sans-serif'; g.fillText('SMSC', x + 8, y + 22); g.fillText('LAN9514', x + 6, y + 34);
  // USB ports
  for (const yy of [2, 19]) { [x, y, w, h] = mmBox(70, yy, 87.5, yy + 15); const ug = g.createLinearGradient(x, y, x, y + h); ug.addColorStop(0, '#e6e9ec'); ug.addColorStop(1, '#9ca3aa'); shadow(g, () => { g.fillStyle = ug; g.fillRect(x, y, w, h); }, 8, 4, 6); g.fillStyle = ug; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(x + 4, y + 4, w - 8, h - 8); }
  // Ethernet
  [x, y, w, h] = mmBox(66, 38, 87.5, 54); const eg = g.createLinearGradient(x, y, x, y + h); eg.addColorStop(0, '#e2e5e8'); eg.addColorStop(1, '#8f979f');
  shadow(g, () => { g.fillStyle = eg; g.fillRect(x, y, w, h); }, 8, 4, 6); g.fillStyle = eg; g.fillRect(x, y, w, h);
  g.fillStyle = '#ffd34a'; g.fillRect(x + 6, y + 6, 10, 6); g.fillStyle = '#4ade80'; g.fillRect(x + 6, y + h - 12, 10, 6);
  // HDMI, power, audio
  [x, y, w, h] = mmBox(24.5, 50, 39.5, 57.5); g.fillStyle = '#c3c8cd'; g.fillRect(x, y, w, h); g.fillStyle = '#20252b'; g.fillRect(x + 10, y + 10, w - 20, h - 22);
  [x, y, w, h] = mmBox(6.5, 52, 14, 57.5); g.fillStyle = '#c3c8cd'; g.fillRect(x, y, w, h);
  [x, y, w, h] = mmBox(50, 50, 57, 57.5); g.fillStyle = '#151719'; g.fillRect(x, y, w, h); g.fillStyle = '#333'; g.beginPath(); g.arc(x + w / 2, y + h / 2, 10, 0, 7); g.fill();
  // FFC connectors
  [x, y, w, h] = mmBox(1, 18, 5, 36); g.fillStyle = '#f2f2ee'; g.fillRect(x, y, w, h); g.fillStyle = '#111'; g.fillRect(x + 6, y + 4, w - 12, h - 8);
  [x, y, w, h] = mmBox(43, 41, 47, 55); g.fillStyle = '#f2f2ee'; g.fillRect(x, y, w, h); g.fillStyle = '#111'; g.fillRect(x + 6, y + 4, w - 12, h - 8);
  // antenna + LEDs
  [x, y, w, h] = mmBox(1, 43, 8, 50); g.fillStyle = '#d9d2c3'; g.fillRect(x, y, w, h);
  let [lx, ly] = mm(1.5, 10); g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(lx, ly, 5, 0, 7); g.fill(); g.fillStyle = 'rgba(255,60,60,0.35)'; g.beginPath(); g.arc(lx, ly, 14, 0, 7); g.fill();
  [lx, ly] = mm(1.5, 13.5); g.fillStyle = '#4ade80'; g.beginPath(); g.arc(lx, ly, 5, 0, 7); g.fill(); g.fillStyle = 'rgba(74,222,128,0.35)'; g.beginPath(); g.arc(lx, ly, 14, 0, 7); g.fill();
  // silkscreen
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'bold 16px sans-serif'; [lx, ly] = mm(33, 18); g.fillText('Raspberry Pi 3 Model B V1.2', lx, ly);
  g.font = '12px sans-serif'; g.fillText('© Raspberry Pi 2015', lx, ly + 20);

  // mug (top view)
  const mx = 1600, my = 765;
  shadow(g, () => { g.fillStyle = '#dfe3e7'; g.beginPath(); g.arc(mx, my, 112, 0, 7); g.fill(); }, 30, 14, 20);
  g.strokeStyle = '#d7dce1'; g.lineWidth = 26; g.beginPath(); g.arc(mx + 132, my + 6, 34, -1.3, 1.3); g.stroke();
  let mg = g.createRadialGradient(mx - 30, my - 30, 10, mx, my, 115); mg.addColorStop(0, '#ffffff'); mg.addColorStop(1, '#b9c0c7');
  g.fillStyle = mg; g.beginPath(); g.arc(mx, my, 112, 0, 7); g.fill();
  mg = g.createRadialGradient(mx + 10, my + 10, 5, mx, my, 92); mg.addColorStop(0, '#5a361f'); mg.addColorStop(1, '#2a160b');
  g.fillStyle = mg; g.beginPath(); g.arc(mx, my, 92, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,240,220,0.18)'; g.beginPath(); g.ellipse(mx - 30, my - 34, 34, 12, -0.6, 0, 7); g.fill();

  // key light + vignette
  gr = g.createRadialGradient(W * 0.38, H * 0.3, 80, W * 0.5, H * 0.5, W * 0.75);
  gr.addColorStop(0, 'rgba(255,236,210,0.06)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return c;
}

function makeNoise() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 20; }
  g.putImageData(img, 0, 0); return c;
}

/* ---------------- engine ---------------- */
/**
 * @param {any} canvas legacy template code: DOM types are left loose on purpose
 * @param {any} layer
 * @param {{ accent?: string, onDetect?: (...args: any[]) => void, onPhase?: (phase: string) => void, onLive?: (status: string, fps: number, labels: string[]) => void }} [opts]
 */
export function createVision(canvas, layer, { accent = '#4FC3FF', onDetect, onPhase, onLive } = {}) {
  const g = canvas.getContext('2d');
  let painted = null, noise = null, raf = 0, active = false, t0 = 0, last = 0;
  let zt = 0, zTarget = 0, userView = null;
  // M7: a real photo from the brain ({ frame, objects, status }) instead of the painted desk; null = the painted desk
  let photo = null, img = null, failed = false, objs = OBJECTS;
  // M7.1: live video from vega-vision (an MJPEG <img>) and its YOLO boxes (EventSource); null when not live
  let live = null;
  let det = [], cards = [], parts = [];
  const partP = PARTS.map(() => 0);
  const ease = (x) => 1 - Math.pow(1 - x, 3);

  // HTML callouts, built with textContent: labels of a real photo come from a model
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function buildCards() {
    layer.replaceChildren();
    cards = objs.map((o) => {
      const c = el('div', `vcard${o.hero ? ' hero' : ''}`), vt = el('div', 'vt');
      vt.append(el('span', '', o.name), ...(o.conf !== undefined ? [el('b', '', `${Math.round(o.conf * 100)}%`)] : []));
      c.append(vt, ...(o.sub ? [el('div', 'vs', o.sub)] : []), ...(o.hero ? [el('div', 'vh', 'Inspecting components…')] : []));
      layer.append(c); return c;
    });
    parts = photo ? [] : PARTS.map((p) => { const c = el('div', 'vpart'), vt = el('div', 'vt'); vt.append(el('span', '', p.name)); c.append(vt, el('div', 'vs', p.sub)); layer.append(c); return c; });
    det = objs.map(() => 0);
  }
  buildCards();

  function openLive() {
    const im = new Image();
    im.src = LIVE_URL; // an MJPEG stream: the image always holds the newest frame
    const es = new EventSource(`${LIVE_URL}/objects`);
    live = { img: im, es, status: photo.status === 'unplugged' ? 'unplugged' : 'connecting', fps: 0 };
    const mine = live;
    es.onmessage = (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch { return; }
      if (live !== mine || !d || typeof d.status !== 'string') return;
      live.status = d.status; live.fps = +d.fps || 0;
      if (d.status === 'timeout') closeLive(); // the session cap (L5): the page offers to continue, it never reconnects alone
      setObjects(Array.isArray(d.objects) ? d.objects : []);
      onLive && onLive(live.status, live.fps, objs.map((o) => o.name));
    };
  }
  /** Stops the video and the boxes (the camera closes 10 s later); `live` stays to tell why the screen is empty. */
  function closeLive() {
    if (!live || live.closed) return;
    live.es.close(); live.img.src = ''; live.closed = true;
  }
  // live boxes: matched to the previous ones by label so they glide instead of jumping (cur -> box every frame)
  function setObjects(list) {
    const prev = objs, names = prev.map((o) => o.name).join('|');
    objs = list.filter((o) => o && typeof o.label === 'string' && Array.isArray(o.box) && o.box.length === 4).slice(0, 20).map((o) => {
      const [x, y, w, h] = o.box.map(Number), right = x > 0.6, box = [x * W, y * H, w * W, h * H];
      const old = prev.find((p) => p.name === o.label && !p.taken);
      if (old) old.taken = true;
      return { name: o.label, conf: o.conf, box, cur: old ? old.cur : box.slice(), card: [(right ? x : x + w) * W, (y + h / 2) * H, right ? 'l' : 'r'] };
    });
    if (objs.map((o) => o.name).join('|') !== names) { buildCards(); det.fill(1); }
    else objs.forEach((o, i) => { const b = cards[i].querySelector('b'); if (b && o.conf !== undefined) b.textContent = `${Math.round(o.conf * 100)}%`; });
  }

  function bracket(x, y, w, h, len, col, lw) {
    g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
    g.moveTo(x, y + len); g.lineTo(x, y); g.lineTo(x + len, y); g.moveTo(x + w - len, y); g.lineTo(x + w, y); g.lineTo(x + w, y + len);
    g.moveTo(x + w, y + h - len); g.lineTo(x + w, y + h); g.lineTo(x + w - len, y + h); g.moveTo(x + len, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - len); g.stroke();
  }
  function leader(ax, ay, bx, by, col, a) {
    g.globalAlpha = a; g.strokeStyle = col; g.lineWidth = 1.2;
    const ex = ax + (bx - ax) * 0.45;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(ex, by); g.lineTo(bx, by); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(ax, ay, 3.5, 0, 7); g.fill();
    g.beginPath(); g.arc(ax, ay, 8, 0, 7); g.globalAlpha = a * 0.4; g.stroke(); g.globalAlpha = 1;
  }
  function frame(now) {
    if (!active) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    const dpr = Math.min(window.devicePixelRatio, 2), cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const narrow = cw < 900;

    // auto inspect after the overview has settled (the painted desk only)
    if (photo) zTarget = 0; else if (userView === null) zTarget = t > 6 ? 1 : 0; else zTarget = userView === 'inspect' ? 1 : 0;
    zt += (zTarget - zt) * (1 - Math.pow(0.04, dt));
    const ez = zt * zt * (3 - 2 * zt);
    if (!live) onPhase && onPhase(zTarget ? 'inspect' : 'overview');

    // view: cover-fit, then zoom toward the Pi
    const base = narrow ? Math.max(cw / W, ch / H) * 0.9 : Math.min(cw / W, (ch - 40) / H);
    const piW = 85 * PI.k, Z = Math.min(2.4, Math.max(1.1, (narrow ? 0.86 : 0.34) * cw / (piW * base)));
    const sc = base * (1 + (Z - 1) * ez);
    const pcx = PI.x + piW / 2, pcy = PI.y + 28 * PI.k;
    const vx = W / 2 + (pcx - W / 2) * ez, vy = H / 2 + (pcy - H / 2) * ez;
    const scx = cw * (0.5 - (narrow ? 0 : 0.09) * ez), scy = ch * (0.5 - (narrow ? 0.12 : 0.02) * ez);
    const S = (x, y) => [(x - vx) * sc + scx, (y - vy) * sc + scy];

    g.fillStyle = '#05070b'; g.fillRect(0, 0, cw, ch);
    const pic = live ? (!live.closed && live.status !== 'unplugged' && live.img.naturalWidth ? live.img : null) : photo ? img : painted;
    if (!pic) {
      // no photo to show: say why, big and plain
      const msg = live
        ? ({ unplugged: 'CAMERA UNPLUGGED', timeout: 'LIVE VIEW ENDED', error: 'CAMERA ERROR' })[live.status] || (live.closed ? 'LIVE VIEW PAUSED' : 'CONNECTING CAMERA')
        : photo.status === 'unplugged' ? 'CAMERA UNPLUGGED' : photo.status === 'off' ? 'VISION OFF · NO MODEL' : failed || !photo.frame ? 'NO PHOTO' : 'LOADING PHOTO';
      g.fillStyle = '#8FD0FF'; g.font = `600 ${narrow ? 18 : 28}px "Chakra Petch", sans-serif`; g.textAlign = 'center'; g.fillText(msg, cw / 2, ch / 2); g.textAlign = 'left';
      raf = requestAnimationFrame(frame); return;
    }
    const boot = Math.min(1, t / 0.8);
    // shortcut: the photo is stretched to 16:9 (the camera shoots 1280x720); other aspect ratios would look squashed
    g.save(); g.globalAlpha = boot; const [ox, oy] = S(0, 0); g.drawImage(pic, ox, oy, W * sc, H * sc); g.restore();
    if (t < 0.8) for (let i = 0; i < 5; i++) g.drawImage(noise, Math.random() * -200, Math.random() * -200, cw + 400, ch + 400);
    // grade: cool tint, grain, scanlines, vignette
    g.fillStyle = 'rgba(40,110,200,0.06)'; g.fillRect(0, 0, cw, ch);
    g.globalAlpha = 0.8; g.drawImage(noise, (Math.random() * 128) | 0, (Math.random() * 128) | 0, 128, 128, 0, 0, cw, ch); g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0.10)'; for (let y = 0; y < ch; y += 3) g.fillRect(0, y, cw, 1);
    const vg = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.3, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = vg; g.fillRect(0, 0, cw, ch);
    // dim everything but the Pi while inspecting
    if (ez > 0.01) {
      const [px0, py0] = S(PI.x - 20, PI.y - 20), [px1, py1] = S(PI.x + piW + 40, PI.y + 56 * PI.k + 30);
      g.save(); g.fillStyle = `rgba(2,6,14,${0.55 * ez})`; g.beginPath(); g.rect(0, 0, cw, ch); g.roundRect(px0, py0, px1 - px0, py1 - py0, 16); g.fill('evenodd'); g.restore();
    }

    // scan sweep in world space
    const sw = (t - 0.7) / 1.8;
    if (sw > 0 && sw < 1.15) {
      const [, sy] = S(0, sw * H);
      const sg = g.createLinearGradient(0, sy - 90, 0, sy); sg.addColorStop(0, 'rgba(79,195,255,0)'); sg.addColorStop(1, 'rgba(79,195,255,0.28)');
      g.fillStyle = sg; g.fillRect(0, sy - 90, cw, 90); g.fillStyle = accent; g.fillRect(0, sy, cw, 2);
    }

    // detections + callouts
    const placed = [];
    const glide = 1 - Math.pow(0.0005, dt);
    objs.forEach((o, i) => {
      if (o.cur) for (let k = 0; k < 4; k++) o.cur[k] += (o.box[k] - o.cur[k]) * glide;
      const [x, y, w, h] = o.cur || o.box;
      if (det[i] === 0 && t > 0.7 + ((y + h / 2) / H) * 1.8) { det[i] = 0.001; onDetect && onDetect(o); }
      if (det[i] > 0) det[i] = Math.min(1, det[i] + dt * 1.6);
      const e = ease(det[i]), fade = o.hero ? 1 : 1 - ez;
      const card = cards[i];
      if (e <= 0 || fade <= 0.01) { card.style.opacity = 0; return; }
      const [sx, sy] = S(x, y); const sw2 = w * sc, sh2 = h * sc, grow = (1 - e) * 24;
      g.globalAlpha = e * fade;
      g.fillStyle = 'rgba(79,195,255,0.05)'; g.fillRect(sx, sy, sw2, sh2);
      g.strokeStyle = 'rgba(79,195,255,0.35)'; g.lineWidth = 1; g.strokeRect(sx, sy, sw2, sh2);
      bracket(sx - grow, sy - grow, sw2 + grow * 2, sh2 + grow * 2, Math.min(18, sw2 * 0.2), o.hero ? '#ffffff' : accent, o.hero ? 2.5 : 2);
      g.globalAlpha = 1;
      const ca = ease(Math.max(0, Math.min(1, (det[i] - 0.25) / 0.75)));
      const cardA = ca * fade * (o.hero ? 1 - ez : 1);
      card.style.opacity = cardA.toFixed(3);
      if (cardA < 0.01) return;
      let [px, py] = S(o.card[0], o.card[1]);
      const cwid = card.offsetWidth, chei = card.offsetHeight;
      let rx = o.card[2] === 'l' ? px - cwid - 10 : px + 10, ry = py - chei / 2;
      // keep inside the screen, then push down past cards already placed
      const top = 112, bottom = ch - (narrow ? 150 : 96);
      rx = Math.max(12, Math.min(cw - cwid - 12, rx)); ry = Math.max(top, Math.min(bottom - chei, ry));
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((r) => rx < r[0] + r[2] + 8 && rx + cwid + 8 > r[0] && ry < r[1] + r[3] + 8 && ry + chei + 8 > r[1]);
        if (!hit) break; ry = hit[1] + hit[3] + 10; if (ry + chei > bottom) { ry = hit[1] - chei - 10; }
      }
      placed.push([rx, ry, cwid, chei]);
      const lx = o.card[2] === 'l' ? rx + cwid : rx, ly = ry + chei / 2;
      const ax = Math.max(sx, Math.min(sx + sw2, lx)), ay = Math.max(sy, Math.min(sy + sh2, ly));
      leader(ax, ay, lx, ly, o.hero ? '#ffffff' : accent, cardA);
      card.style.transform = `translate(${rx.toFixed(1)}px, ${ry.toFixed(1)}px)`;
    });

    // component labels during inspect
    const placedP = [];
    if (!photo) PARTS.forEach((p, i) => {
      const el = parts[i];
      const target = ez > 0.85 ? 1 : 0;
      partP[i] += ((target ? 1 : 0) - partP[i]) * Math.min(1, dt * (target ? 3.2 - i * 0.18 : 8));
      const a = Math.max(0, partP[i]);
      if (a < 0.01) { el.style.opacity = 0; return; }
      const [x, y, w, h] = p.box; const [sx, sy] = S(x, y); const sw2 = w * sc, sh2 = h * sc;
      g.globalAlpha = a; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.strokeRect(sx, sy, sw2, sh2); g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(sx, sy, sw2, sh2); g.globalAlpha = 1;
      const cx = sx + sw2 / 2, cy = sy + sh2 / 2, k = narrow ? 0.45 : 1;
      const bx = cx + p.off[0] * k, by = cy + p.off[1] * k;
      const left = p.off[0] < 0, ew = el.offsetWidth, eh = el.offsetHeight;
      const maxR = narrow ? cw - 12 : cw - 384;
      let ex = left ? bx - ew - 6 : bx + 6, ey = by - eh / 2;
      ex = Math.max(12, Math.min(maxR - ew, ex)); ey = Math.max(112, Math.min(ch - (narrow ? 330 : 96) - eh, ey));
      for (let q = 0; q < 6; q++) {
        const hit = placedP.find((r) => ex < r[0] + r[2] + 8 && ex + ew + 8 > r[0] && ey < r[1] + r[3] + 6 && ey + eh + 6 > r[1]);
        if (!hit) break; ey = hit[1] + hit[3] + 8;
      }
      placedP.push([ex, ey, ew, eh]);
      el.style.opacity = a.toFixed(3);
      el.style.transform = `translate(${ex.toFixed(1)}px, ${ey.toFixed(1)}px)`;
      leader(cx, cy, left ? ex + ew : ex, ey + eh / 2, accent, a);
    });

    raf = requestAnimationFrame(frame);
  }
  return {
    start() {
      if (!noise) noise = makeNoise();
      if (!photo && !painted) painted = paint();
      if (photo && photo.mode === 'live' && (!live || live.closed) && live?.status !== 'timeout') openLive();
      if (active) return; active = true; t0 = last = performance.now(); zt = 0; userView = null;
      det.fill(0); partP.fill(0); raf = requestAnimationFrame(frame);
    },
    stop() { active = false; cancelAnimationFrame(raf); closeLive(); },
    view(v) { userView = v; },
    /**
     * M7: show this photo (`frame` URL, `objects` with `box` as fractions, `status`), or the painted desk again (null).
     * M7.1: `mode: 'live'` shows the live video and its boxes instead (returns 0: the count comes with each update).
     */
    show(p) {
      closeLive(); live = null;
      photo = p; img = null; failed = false;
      if (p && p.mode === 'live') { objs = []; buildCards(); openLive(); return 0; }
      objs = p ? (p.objects || []).map((o) => {
        const [x, y, w, h] = o.box, right = x > 0.6;
        return { name: o.label, conf: o.conf, box: [x * W, y * H, w * W, h * H], card: [(right ? x : x + w) * W, (y + h / 2) * H, right ? 'l' : 'r'] };
      }) : OBJECTS;
      buildCards();
      if (p && p.frame) {
        const im = new Image();
        im.onload = () => { if (photo !== p) return; img = im; t0 = performance.now(); det.fill(0); };
        im.onerror = () => { if (photo === p) failed = true; };
        im.src = p.frame;
      }
      return objs.length;
    },
    rescan() { t0 = performance.now(); det.fill(0); partP.fill(0); userView = 'overview'; zt = 0; setTimeout(() => { if (userView === 'overview') userView = null; }, 50); }
  };
}
