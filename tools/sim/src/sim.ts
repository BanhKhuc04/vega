/**
 * Publishes fake data following docs/mqtt-contract.md so the dashboard can be exercised
 * with VITE_DATA_SOURCE=mqtt. Dev only.
 *
 *   npm run simulate                      # ws://localhost:9001 (see infra/docker-compose.dev.yml)
 *   MQTT_URL=mqtt://localhost:1883 npm run simulate
 *   npm run simulate -- --offline-after 15   # device bedroom/sensor goes offline after 15 s
 */
import mqtt from 'mqtt';

const url = process.env.MQTT_URL ?? 'ws://localhost:9001';
const arg = (name: string): number | null => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : null;
};
const offlineAfter = arg('offline-after');

const client = mqtt.connect(url, { clientId: `vega-sim-${process.pid}`, reconnectPeriod: 2000 });
const pub = (topic: string, payload: string | object, retain = true) =>
  client.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), { retain });
const iso = () => new Date().toISOString();

const CO2 = [980, 1080, 1190, 1290, 1380, 1420, 1360, 1100, 820, 700, 640, 620, 650, 720, 780, 760, 740, 800, 860, 900, 940, 960, 940, 960];
const devices: [string, string, 'esp8266' | 'esp32-s3'][] = [
  ['bedroom', 'sensor', 'esp8266'],
  ['livingroom', 'light', 'esp8266'],
  ['kitchen', 'plug', 'esp8266'],
  ['balcony', 'sensor', 'esp8266'],
  ['bedroom', 'fan', 'esp8266'],
  ['desk', 'core', 'esp32-s3'],
];
const cores = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'sleep'];

function announce(): void {
  for (const [room, id, kind] of devices) {
    pub(`vega/${room}/${id}/meta`, { v: 1, kind, room_name: room === 'bedroom' ? 'Phòng ngủ' : room });
    pub(`vega/${room}/${id}/availability`, 'online');
  }
  pub('vega/system/events', { v: 1, type: 'co2_series', room: 'bedroom', values: CO2, threshold_ppm: 1000, max_ppm: 1500 });
  pub('vega/system/events', { v: 1, type: 'ci', repo: 'firmware-esp', failed: 1, ts: iso() });
  pub('vega/system/events', { v: 1, type: 'next_event', title: 'nộp lab', at: new Date(Date.now() + 186 * 60_000).toISOString() });
}

let tick = 0;
function telemetry(): void {
  tick++;
  pub('vega/bedroom/sensor/state', {
    v: 1,
    ts: iso(),
    temp_c: +(28.4 + Math.sin(tick / 4)).toFixed(1),
    humidity: 72 + (tick % 3),
    co2_ppm: 1180 + ((tick * 17) % 80),
  });
  pub('vega/desk/core/state', { v: 1, state: cores[Math.floor(tick / 3) % cores.length] });
}

client.on('connect', () => {
  console.log(`[sim] connected to ${url}`);
  announce();
  telemetry();
});
client.on('error', (e) => console.error('[sim] error:', e.message));
client.on('message', (topic, payload) => {
  if (topic !== 'vega/system/command') return;
  console.log('[sim] command received:', payload.toString());
  try {
    const cmd = JSON.parse(payload.toString()) as { id?: string; text?: string };
    if (!cmd.id || !cmd.text) return;
    pub('vega/system/events', { v: 1, type: 'research', session: researchSession(cmd.id, cmd.text) }, false);
    setTimeout(() => pub('vega/system/events', { v: 1, type: 'command_result', id: cmd.id, result: 'Đã nhận lệnh (bản mô phỏng)' }, false), 800);
  } catch {
    /* ignore malformed commands */
  }
});

function researchSession(id: string, text: string) {
  return {
    id,
    title: `Nghiên cứu: ${text}`,
    step_no: 3,
    step_count: 5,
    phase: 'đang đọc nguồn',
    sources: 12,
    sources_desc: 'datasheet, tài liệu thư viện và thảo luận trên diễn đàn (mô phỏng)',
    ref: id,
    steps: [
      { label: 'Hiểu câu hỏi', state: 'done' },
      { label: 'Lập kế hoạch tìm kiếm', state: 'done' },
      { label: 'Đọc & trích xuất', state: 'active', detail: '8/12', progress: 0.66 },
      { label: 'So sánh & tổng hợp', state: 'todo' },
      { label: 'Trả lời kèm nguồn', state: 'todo' },
    ],
    source_caption: 'Nguồn mô phỏng',
    compare: {
      title: 'A vs B',
      columns: ['Tiêu chí', 'A', 'B'],
      rows: [{ label: 'Độ chính xác', cells: [{ text: 'Cao', tone: 'good' }, { text: 'Trung bình', tone: 'warn' }] }],
    },
    note: 'Kết luận mô phỏng, chỉ để thử luồng dữ liệu.',
    note_refs: 'nguồn [1]',
  };
}
client.subscribe('vega/system/command');
setInterval(() => client.connected && telemetry(), 2000);

if (offlineAfter !== null) {
  setTimeout(() => {
    console.log('[sim] bedroom/sensor -> offline');
    pub('vega/bedroom/sensor/availability', 'offline');
  }, offlineAfter * 1000);
}
