import type { HistoryEntry, ResearchSession, Snapshot } from './types';

/** Sample CO₂ series from the design canvas (24 hourly values, scale 0–1500, threshold 1000). */
export const SAMPLE_CO2 = [
  980, 1080, 1190, 1290, 1380, 1420, 1360, 1100, 820, 700, 640, 620, 650, 720, 780, 760, 740, 800,
  860, 900, 940, 960, 940, 960,
];

export function makeSampleSession(id: string, title: string, ts: number): ResearchSession {
  return {
    id,
    title,
    stepNo: 3,
    stepCount: 5,
    phase: 'đang đọc nguồn',
    sources: 12,
    sourcesDesc: 'datasheet, tài liệu thư viện ESPHome, bài so sánh và thảo luận trên diễn đàn',
    ref: `${id} · ${new Date(ts).toTimeString().slice(0, 8)}`,
    steps: [
      { label: 'Hiểu câu hỏi', state: 'done' },
      { label: 'Lập kế hoạch tìm kiếm', state: 'done' },
      { label: 'Đọc & trích xuất', state: 'active', detail: '8/12', progress: 8 / 12 },
      { label: 'So sánh & tổng hợp', state: 'todo' },
      { label: 'Trả lời kèm nguồn', state: 'todo' },
    ],
    sourceCaption: 'Cảm biến NDIR đo CO₂ thật',
    compare: {
      title: 'NDIR vs MOX',
      columns: ['Tiêu chí', 'NDIR', 'MOX'],
      rows: [
        { label: 'Đo CO₂', cells: [{ text: 'Thật', tone: 'good' }, { text: 'Ước lượng (eCO₂)', tone: 'warn' }] },
        { label: 'Giao tiếp', cells: [{ text: 'I2C / UART', tone: 'plain' }, { text: 'I2C', tone: 'plain' }] },
        { label: 'Chạy với ESP8266', cells: [{ text: 'Được', tone: 'good' }, { text: 'Được', tone: 'good' }] },
      ],
    },
    note: 'Nên chọn cảm biến NDIR vì đo CO₂ thật; loại MOX chỉ suy ra từ khí VOC nên dễ sai trong phòng ngủ. Cả hai đều nối được vào ESP8266 sẵn có.',
    noteRefs: 'nguồn [1] [4] [7] · đang xác minh',
  };
}

export function makeSampleSnapshot(now: number): Snapshot {
  const hist = (n: number, minsAgo: number, text: string, result: string): HistoryEntry => {
    const ts = now - minsAgo * 60_000;
    return {
      id: `VG-${String(n).padStart(4, '0')}`,
      ts,
      text,
      result,
      session: makeSampleSession(`VG-${String(n).padStart(4, '0')}`, `Nghiên cứu: ${text}`, ts),
    };
  };
  return {
    sourceKind: 'mock',
    isMock: true,
    connection: 'connected',
    env: { room: 'bedroom', roomName: 'Phòng ngủ', tempC: 28.4, humidity: 72, co2Ppm: 1180, ts: now },
    roomNames: { bedroom: 'Phòng ngủ' },
    devices: [
      ...['bedroom/sensor', 'livingroom/light', 'kitchen/plug', 'balcony/sensor', 'bedroom/fan'].map((id) => ({
        id,
        kind: 'esp8266' as const,
        online: true,
      })),
      { id: 'desk/core', kind: 'esp32-s3' as const, online: true },
    ],
    ci: { repo: 'firmware-esp', failed: 1, ts: now - 4 * 60_000 },
    next: { title: 'nộp lab', at: now + (3 * 60 + 6) * 60_000 },
    co2: { room: 'bedroom', values: SAMPLE_CO2, thresholdPpm: 1000, maxPpm: 1500 },
    research: makeSampleSession('VG-0141', 'Nghiên cứu: cảm biến CO₂ cho phòng ngủ', now - 5 * 60_000),
    core: 'idle',
    history: [
      hist(141, 5, 'nghiên cứu cảm biến CO₂ cho phòng ngủ', 'Khuyên dùng cảm biến NDIR (dữ liệu mẫu)'),
      hist(140, 62, 'sao CI lỗi?', 'firmware-esp: lỗi biên dịch ở bước linking (dữ liệu mẫu)'),
      hist(139, 190, 'tắt đèn phòng khách', 'Đã tắt 1 đèn (dữ liệu mẫu)'),
    ],
  };
}
