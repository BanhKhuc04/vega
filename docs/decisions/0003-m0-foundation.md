# Decision Brief 0003 — M0 · Nền móng

| | |
|---|---|
| **Ngày** | 2026-11-18 |
| **Trạng thái** | Đã duyệt, chuyển sang triển khai |
| **Dựa trên** | 0002 — Phương án sản phẩm VEGA 1.0 (đã duyệt) |
| **Thay cho** | 0001 (giao diện canvas, đánh dấu *Superseded*) |
| **Người triển khai** | Phiên Claude Code (Sonnet 5.5) |
| **Nhánh** | `feat/m0-foundation`, tách từ `feat/vega-ui-v0.1` để giữ lịch sử |
| **Template hình ảnh** | `design/final:vega/` |

---

## 1. Mục tiêu M0

Dựng **xương sống** để mọi mốc sau chỉ việc cắm thêm vào:
- Monorepo, schema dùng chung, giao thức cảnh.
- Template VEGA Core chạy bằng dữ liệu giả lập qua MQTT, có 3 mức chất lượng.
- Hạ tầng chạy được trên PC và trên Pi 3.

M0 **chưa có** bộ não, chưa có AI, chưa có phần cứng thật.

**Xong khi:** trên PC và trên Pi, màn VEGA chạy bằng dữ liệu giả lập. Bắn một cảnh qua MQTT thì mọi màn đang mở cùng đổi.

## 2. Quyết định riêng của M0

| # | Quyết định |
|---|---|
| M0-1 | **npm workspaces** ở gốc: `packages/contract`, `dashboard`, `tools/sim`. Thêm `brain/`, `pc-agent/`, `firmware/` (chỉ README giữ chỗ) |
| M0-2 | **`packages/contract`** (TS + zod) là nơi duy nhất định nghĩa: danh sách topic, payload thiết bị (`state`, `meta`, `availability`), `vega/system/*` (`events`, `command`, `pi`, `net`), **giao thức cảnh `vega/ui/scene`** với schema dữ liệu cho cả 11 template, và phiên bản hợp đồng. Dashboard và (sau này) brain chỉ import từ đây |
| M0-3 | **Dashboard = template `design/final:vega/`** chuyển vào `dashboard/`. Gỡ toàn bộ giao diện Svelte theo canvas cũ và các phụ thuộc Svelte. Lớp dữ liệu cũ (`MockSource`, `MqttSource`, parser, reducer, MiniMqttClient) được giữ và chuyển sang TS thuần (bỏ rune Svelte). Phần nào thuộc hợp đồng thì đưa vào `packages/contract` |
| M0-4 | **Bộ vẽ cảnh**: dashboard subscribe `vega/ui/scene` (retained). Payload hợp lệ → `setMode(scene)` + đổ `data` vào template, giữ nguyên các hàm hiệu ứng có sẵn (`countUp`, `scramble`, `typeText`, `zap`, `revealPanels`). Thiếu trường nào → dùng giá trị mặc định là chữ và số hiện có trong template. Payload sai schema → bỏ qua, `console.warn` một lần, không crash. Hết `ttl` → về `idle`. Dock, phím tắt, `#hash` vẫn dùng được để xem tay |
| M0-5 | **Dữ liệu sống cho Idle, header, callout**: phòng (nhiệt, ẩm, CO₂ + sparkline), hiện diện, mesh x/y, CI, sự kiện kế tiếp, nhiệt/CPU Pi, độ trễ. Không có dữ liệu thật thì hiện giá trị mẫu kèm nhãn "sample data" |
| M0-6 | **3 mức chất lượng** `?quality=full\|lite\|css` + tự hạ cấp: full < 30 FPS trong 3 giây → lite; lite < 24 FPS → css; không có WebGL → css; `prefers-reduced-motion` → css và tắt animation. **lite**: không bloom, khoảng 1.500 hạt, pixel ratio 1, tắt mưa ký tự và scanline. **css**: không tạo WebGL context, quả cầu dựng bằng CSS/SVG theo đúng phong cách template. Mức đang chạy hiện ở header, đổi tay được, nhớ bằng `localStorage` (có try/catch) |
| M0-7 | **Trạng thái kết nối trên header**: `LIVE` / `RECONNECTING` / `OFFLINE` / `SIM`. Mất broker thì giữ cảnh cuối, không trắng màn |
| M0-8 | **`tools/sim`**: thiết bị ảo publish đúng hợp đồng (môi trường, CO₂ theo chu kỳ ngày đêm, radar, relay nhận lệnh `set`, availability/LWT, Pi stats, CI chuyển trạng thái). Lệnh `npm run scene -- <tên> [file.json]` để bắn cảnh. Có thư mục `tools/sim/examples/` chứa một JSON mẫu cho mỗi template |
| M0-9 | **Test MQTT không cần Docker**: e2e dùng broker chạy trong tiến trình (aedes + websocket), để CI và container cloud đều chạy được |
| M0-10 | **Font tự host** (Michroma, Chakra Petch, JetBrains Mono qua `@fontsource`). Không có request nào ra mạng ngoài broker |
| M0-11 | **Hạ tầng**: `infra/docker-compose.dev.yml` (Mosquitto ẩn danh, chỉ cho dev, WS 9001). `infra/pi/docker-compose.yml` (Mosquitto **có mật khẩu và ACL**, listener WS cho dashboard, `vega-ui` nginx, `restart: unless-stopped`, giới hạn RAM). `infra/pi/setup.sh` idempotent: Docker, zram, cấu hình kiosk Chromium mở `?quality=css`. Script chỉ được viết và kiểm tra cú pháp ở đây, chủ dự án tự chạy trên Pi |

## 3. Scope of Work

| ID | Việc |
|---|---|
| W1 | Đổi cấu trúc repo sang workspaces (M0-1). Script gốc: `dev`, `build`, `lint`, `check`, `test`, `test:e2e`, `sim`, `scene` |
| W2 | `packages/contract` (M0-2) + unit test cho mọi schema (hợp lệ, thiếu trường, sai kiểu) |
| W3 | Chuyển template vào `dashboard/`, gỡ Svelte, giữ đúng hình ảnh (M0-3). Không commit `.vite/` |
| W4 | Bộ vẽ cảnh + TTL (M0-4) |
| W5 | Gắn dữ liệu sống (M0-5) |
| W6 | 3 mức chất lượng + tự hạ cấp (M0-6) |
| W7 | Trạng thái kết nối (M0-7) |
| W8 | `tools/sim` + `scene` CLI + JSON mẫu (M0-8) |
| W9 | Hạ tầng dev và Pi (M0-11) |
| W10 | CI GitHub Actions: lint, check, test, build, e2e (Chromium có sẵn của Playwright), kiểm tra kích thước bundle |
| W11 | Tài liệu: `README.md`, `docs/contract.md` (v2, có giao thức cảnh), `docs/pi-setup.md`, `docs/decisions/0001` (thêm dòng *Superseded by 0002/0003*), `0002-vega-product-plan-1.0.md`, `0003-m0-foundation.md` |

**Ngoài phạm vi M0:** bộ não (M1), gọi AI, giọng nói, camera, Google, GitHub thật, Telegram, Console, firmware. Không "cải tiến" hình ảnh template ngoài M0-6/M0-7. Thay đổi hình ảnh nào khác thì hỏi chủ dự án trước.

## 4. Definition of Done

### Chức năng
- [ ] Ở thư mục gốc, `npm ci && npm run dev` mở dashboard ở chế độ `SIM` với dữ liệu giả lập, không cần broker.
- [ ] Ở mức `full`, cả 11 cảnh **giống template** `design/final:vega/` (so ảnh chụp cùng cảnh ở 1440×900, đính kèm ảnh hai bên trong PR).
- [ ] `docker compose -f infra/docker-compose.dev.yml up` + `npm run sim` + dashboard chế độ mqtt: các ô Idle, header, callout cập nhật **trong vòng 2 giây**. Thiết bị offline thì mesh giảm ngay.
- [ ] Mở 2 tab dashboard, chạy `npm run scene -- research tools/sim/examples/research.json`: **cả hai** chuyển cảnh trong vòng 1 giây với dữ liệu từ file. Hết `ttl` thì về idle. Gửi JSON sai thì bị bỏ qua, không crash.
- [ ] Gửi sự kiện CI fail lên `vega/system/events` thì sim (hoặc một rule tạm trong sim) bắn cảnh `alert`.
- [ ] `?quality=css` không tạo WebGL context (có test kiểm tra). Logic tự hạ cấp có unit test với FPS giả lập. `prefers-reduced-motion` dừng animation.
- [ ] Tắt broker: header `RECONNECTING`, giữ cảnh cuối, không trắng màn. Bật lại thì tự `LIVE`.
- [ ] Ở 390×844, cả 11 cảnh không có chữ đè chữ, không cuộn ngang.

### Chất lượng
- [ ] `npm run lint`, `npm run check` (TS strict cho code mới; `checkJs` cho JS cũ của template), `npm test` đều qua.
- [ ] Unit test: schema contract, bộ vẽ cảnh (hợp lệ / thiếu trường / sai / TTL), chọn mức chất lượng, reducer dữ liệu. Test cũ của lớp dữ liệu vẫn qua.
- [ ] E2E Playwright + broker trong tiến trình: tải trang, bắn 11 cảnh qua MQTT, kiểm tra cảnh đổi, chụp ảnh ở 1440 và 390, **không có lỗi console**.
- [ ] Không có request mạng nào ngoài broker (e2e chặn và kiểm tra).
- [ ] JS ≤ 300 KB gzip.
- [ ] Trợ năng: nút là `<button>` có nhãn, ô lệnh có `<label>`, focus nhìn thấy được, chữ đạt tương phản ≥ 4.5:1. Âm thanh không phát khi chưa có tương tác.
- [ ] Không commit bí mật, `.vite/`, `node_modules/`, `dist/`. Có `.env.example` và `infra/pi/.env.example`.
- [ ] `docker build` image `vega-ui` thành công (nếu container không có Docker thì ghi rõ trong PR). `infra/pi/setup.sh` qua `bash -n` và `shellcheck`.
- [ ] GitHub Actions xanh trên PR.

### Quy trình
- [ ] Commit nhỏ theo W1–W11.
- [ ] PR vào `main`: checklist này tích bằng bằng chứng thật (output lệnh), ảnh so sánh, ô chưa đạt ghi rõ lý do. Đóng hoặc ghi chú rằng nhánh `feat/vega-ui-v0.1` đã được thay bằng nhánh này.

### Trên Pi thật *(chủ dự án làm sau khi merge)*
- [ ] *(Pi thật)* Chạy `infra/pi/setup.sh`, compose lên, kiosk mở VEGA ở mức css.
- [ ] *(Pi thật)* Từ PC chạy `npm run scene -- briefing` trỏ vào broker của Pi thì màn Pi và tab trên PC cùng đổi.
- [ ] *(Pi thật)* Rút điện cắm lại thì mọi thứ tự lên. Kiosk ≥ 30 FPS, RAM tổng < 800 MB.
