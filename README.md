# VEGA

Trợ lý cá nhân chạy 24/7 trên Raspberry Pi 3, có màn hình FUI ở bàn và trên PC. Bản này là **M0 · Nền móng**:
monorepo, hợp đồng dùng chung, màn VEGA Core chạy bằng dữ liệu giả lập qua MQTT, hạ tầng cho PC và Pi.
Chưa có bộ não, chưa có AI, chưa có phần cứng thật (xem `docs/decisions/0002-vega-product-plan-1.0.md`).

> Chữ trên giao diện giữ tiếng Anh như template; tài liệu và ghi chú dự án bằng tiếng Việt.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `packages/contract` | topic MQTT, schema payload (zod) và **giao thức cảnh** `vega/ui/scene` cho 11 template. Nơi duy nhất định nghĩa hợp đồng |
| `dashboard` | màn VEGA Core (template `design/final:vega/`: Three.js + GSAP), lớp dữ liệu, bộ vẽ cảnh |
| `tools/sim` | thiết bị ảo, `npm run scene`, broker MQTT chạy trong tiến trình (không cần Docker) |
| `infra` | compose cho dev và cho Pi (Mosquitto có mật khẩu + ACL, nginx), `setup.sh` |
| `brain`, `pc-agent`, `firmware` | chỗ giữ chỗ cho các mốc sau (M1, M5, M2) |
| `docs` | hợp đồng, hướng dẫn Pi, các Decision Brief |

## Chạy thử (PC)

Cần Node.js 22.

```bash
npm ci
npm run dev          # http://localhost:5173, chế độ SIM: dữ liệu giả lập ngay trong trình duyệt, không cần broker
```

Header hiện trạng thái kết nối: `SIM` (không có broker), `LIVE`, `RECONNECTING`, `OFFLINE`. Dock, phím số 1–9/0/- và `#hash`
(ví dụ `/#briefing`) vẫn chuyển cảnh bằng tay.

### Với broker MQTT

```bash
npm run broker                       # broker dev trong tiến trình: mqtt://localhost:1883, ws://localhost:9001 (không mật khẩu!)
#   hoặc: docker compose -f infra/docker-compose.dev.yml up      (Mosquitto, cùng cổng)
npm run sim                          # thiết bị ảo: môi trường, CO₂ theo giờ, radar, 2 relay, Pi stats, CI
VITE_DATA_SOURCE=mqtt npm run dev    # hoặc mở http://localhost:5173/?source=mqtt
```

Bắn một cảnh cho mọi màn đang mở:

```bash
npm run scene -- research tools/sim/examples/research.json
npm run scene -- briefing                      # dùng tools/sim/examples/briefing.json
npm run scene -- alert --ttl 20                # hết ttl thì về idle
npm run scene -- research bad.json --raw       # gửi nguyên văn một file sai để thử: các màn sẽ bỏ qua
```

Trong cửa sổ `npm run sim`, gõ `fail` hoặc `pass` để phát sự kiện CI (sim bắn cảnh `alert` / `success`),
`kill bedroom/env` để một thiết bị mất kết nối (Last Will `offline`, mesh giảm ngay), `revive bedroom/env` để bật lại.

Trỏ vào broker của Pi: `MQTT_URL=mqtt://pi.local:1883 MQTT_USER=brain MQTT_PASS=… npm run scene -- briefing`
(hoặc các cờ `--url`, `--user`, `--pass`).

### Ba mức chất lượng

`?quality=full|lite|css`, nhớ bằng `localStorage` khi bấm nút `QUALITY` trên header (đổi tay sẽ tải lại trang).

| Mức | Khác biệt |
|---|---|
| `full` | đúng template: bloom, ~6.500 hạt, mưa ký tự, scanline |
| `lite` | không bloom, ~1.500 hạt, pixel ratio 1, tắt mưa ký tự và scanline |
| `css` | **không tạo WebGL context**; quả cầu dựng bằng CSS/SVG |

Tự hạ cấp khi không chọn tay: `full` dưới 30 FPS trong 3 giây → `lite`; `lite` dưới 24 FPS → `css`; không có WebGL → `css`;
`prefers-reduced-motion` → `css` và tắt animation.

## Kiểm tra

```bash
npm run lint && npm run check && npm test      # lint, TypeScript strict (+ checkJs cho JS của template), unit test
npm run build && npm run size                  # build và ngân sách JS ≤ 300 KB gzip
npm run test:e2e                               # Playwright + broker trong tiến trình (cần: npx playwright install chromium)
MQTT_E2E=1 npm run test:e2e                    # (CI) thêm các kịch bản qua MQTT
SHOTS=1 npm run test:e2e                       # chụp ảnh vào docs/screenshots/m0
npm run compare                                # ảnh cạnh nhau với template gốc (docs/screenshots/m0/compare)
```

## Triển khai

- Chỉ dashboard, chế độ SIM: `docker compose -f infra/docker-compose.yml up --build` → http://localhost:8080
- Raspberry Pi 3 (Mosquitto có mật khẩu và ACL, dashboard, kiosk Chromium ở mức `css`): xem **`docs/pi-setup.md`**.

## Tài liệu

- `docs/contract.md`: topic, payload, giao thức cảnh (revision 2)
- `docs/pi-setup.md`: cài Pi
- `docs/decisions/0002-vega-product-plan-1.0.md`: phương án sản phẩm 1.0 (9 mốc)
- `docs/decisions/0003-m0-foundation.md`: brief M0 (phần này)
- `docs/decisions/0001-vega-ui-v0.1.md`: *Superseded by 0002/0003*
