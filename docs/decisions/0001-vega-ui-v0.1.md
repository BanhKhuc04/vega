# Decision Brief 0001 — VEGA v0.1: biến giao diện FUI thành web app chạy thật

| | |
|---|---|
| **Ngày** | 2026-11-18 |
| **Trạng thái** | **Superseded by 0002 / 0003** (đã duyệt rồi thay bằng phương án VEGA 1.0; giao diện Svelte theo canvas bị gỡ, lớp dữ liệu và hợp đồng MQTT được giữ lại và nâng cấp) |
| **Người quyết định** | Chủ dự án |
| **Người triển khai** | Phiên Claude Code riêng (Sonnet 5.5) |
| **Tài liệu gốc** | Canvas thiết kế "VEGA — Giao diện FUI" · Roadmap dự án (bản hiện còn ghi tên "Jarvis") |

---

## 1. Bối cảnh

- Roadmap chia dự án trợ lý cá nhân 24/7 thành 8 giai đoạn (Phase 0–7, khoảng 14–18 tuần). Kiến trúc: Raspberry Pi 3 làm bộ não, các node ESP nói chuyện qua Mosquitto (MQTT), AI trên cloud.
- Thiết kế giao diện FUI tông xanh điện đã xong, gồm hai phần:
  - **Màn hình chính** (1440×1060, co giãn): 3 chế độ Chờ / Nghiên cứu / Tập trung, header có nút chuyển chế độ, thanh ra lệnh ở dưới.
  - **Màn tròn trên bàn** (ESP32-S3 + GC9A01 240×240): 6 trạng thái của lõi (chờ, đang nghe, đang nghĩ, đang nói, cảnh báo, ngủ).
- Lần rà soát thiết kế ngày 18/11 tìm ra 5 vấn đề. Bản này xử lý 4 vấn đề; vấn đề "Wake word" ghi lại thành việc còn mở:
  1. Ở chế độ Chờ, 4 khối số liệu ở 4 góc **đè lên nhau khi màn hẹp ~390px**.
  2. Nút **"Lịch sử" chưa làm gì**.
  3. Nhiều hiệu ứng nặng (blur, drop-shadow, khoảng 8 vòng xoay, 18 hạt sáng) **dễ giật trên Pi 3**.
  4. Wake word "Hey Vega" không có sẵn trong ESP-SR → phải tự huấn luyện (xem mục 8).
  5. **Tên chưa thống nhất** (VEGA và Jarvis).

## 2. Câu hỏi cần quyết

> Phần việc đầu tiên đem ra code là gì, viết bằng stack nào, và **thế nào thì tính là xong**?

## 3. Các phương án

| | Phương án | Ưu | Nhược |
|---|---|---|---|
| A | Làm Phase 0–1 trước (Mosquitto, registry, recorder) | Đúng thứ tự roadmap | Phải có Pi và ESP thật mới kiểm tra được; làm xong cũng chưa thấy gì trên màn hình |
| **B** | **Dựng giao diện VEGA thành web app tĩnh. Dữ liệu đi qua một lớp adapter: dùng dữ liệu mẫu ngay, chuyển sang MQTT-over-WebSocket khi Phase 1 xong** | Chạy được ngay trên laptop, không cần phần cứng. Chốt luôn **hợp đồng dữ liệu** (topic, payload) mà Phase 1 phải theo. Thiết kế vừa xong nên vẫn còn nhớ rõ | Phải bổ sung Phase 1 sau thì mới có dữ liệu thật |
| C | Làm A và B song song | Tiến độ nhanh trên giấy | Vi phạm nguyên tắc "mỗi giai đoạn là một bản chạy được, không làm dở nhiều thứ" |

**Chọn B.**

## 4. Quyết định chi tiết

| # | Quyết định | Lý do | Phương án thay thế bị loại |
|---|---|---|---|
| D1 | **Tên chính thức: VEGA.** Câu gọi "Hey Vega". Tiền tố MQTT là `vega/` thay cho `jarvis/` | Chốt theo lựa chọn của chủ dự án | NOVA, AEGIS, ORION, ECHO, ASTRA |
| D2 | **Vite + TypeScript (strict) + Svelte 5**, build ra file tĩnh, không SSR | Bundle nhỏ, không có virtual DOM, hợp với Pi 3. Svelte đã có trong roadmap (SvelteKit) | Next.js (nặng cho kiosk Pi 3), vanilla TS (khó bảo trì khi thêm màn) |
| D3 | **Tự host font** Chakra Petch và JetBrains Mono (woff2, giấy phép OFL) | Nguyên tắc "cục bộ trước": kiosk vẫn phải đẹp khi mất internet | Google Fonts CDN |
| D4 | **Lớp dữ liệu `VegaDataSource`** có 2 bản cài đặt: `MockSource` (mặc định) và `MqttSource` (mqtt.js qua WebSocket). Chọn bằng `VITE_DATA_SOURCE=mock\|mqtt` | UI không phụ thuộc phần cứng; đổi nguồn dữ liệu không phải sửa component | Gọi thẳng MQTT trong component |
| D5 | **Chế độ Lite** bật khi có `?lite=1`, khi máy đặt `prefers-reduced-motion`, hoặc tự bật nếu FPS đo được < 30 trong 3 giây đầu. Lite tắt blur và drop-shadow động, bỏ hạt sáng, chỉ giữ 2 vòng xoay | Xử lý vấn đề 3 cho Pi 3 | Bắt người dùng tự chỉnh |
| D6 | **Triển khai:** build tĩnh → image `nginx:alpine` (multi-arch, chạy được ARM64), service `vega-ui` trong `infra/docker-compose.yml`. Chromium kiosk trên Pi **chỉ có hướng dẫn viết tay** | Đúng stack Docker Compose của roadmap; việc cài kiosk trên Pi thật là của chủ dự án | Self-hosted runner trên Pi |
| D7 | **Repo dạng monorepo** theo roadmap: `brain/`, `firmware/`, `dashboard/`, `infra/`, `docs/`. Brief này nằm ở `docs/decisions/0001-vega-ui-v0.1.md` | Theo đúng Phase 0 của roadmap | Mỗi phần một repo |

## 5. Scope of Work

### Trong phạm vi

| ID | Hạng mục | Mô tả |
|---|---|---|
| S1 | Khung monorepo | `brain/`, `firmware/` chỉ có README giữ chỗ. `dashboard/` chứa app. `infra/`, `docs/decisions/`. Có `.gitignore`, `.editorconfig`, `.env.example` |
| S2 | Màn hình chính, 3 chế độ | Chờ / Nghiên cứu / Tập trung **giống thiết kế**: màu (`#05070D`, `#4FC3FF`, `#9FD6FF`, `#2F8BFF`, cam `#FFC266`, đỏ `#FF7A90`, xanh lá `#8FE3B0`), font, lưới nền 64px, góc ngoặc, animation (quả cầu xoay, quét sáng, bảng bay vào, cột biểu đồ mọc lên). Header có trạng thái hệ thống và nút chế độ (`aria-pressed`) |
| S3 | Màn Lịch sử | Sửa vấn đề 2: liệt kê các lệnh đã gửi (thời gian, nội dung, kết quả mẫu). Bấm một mục để mở lại màn Nghiên cứu của lệnh đó |
| S4 | Responsive | Sửa vấn đề 1: dưới 720px, 4 khối số liệu góc chuyển thành lưới 2×2 nằm trên quả cầu. Nav xuống dòng, bảng so sánh cuộn trong khung. Không có cuộn ngang ở 390px |
| S5 | Lớp dữ liệu | Kiểu dữ liệu cho: môi trường phòng, mạng thiết bị, CI/CD, sự kiện kế tiếp, phiên nghiên cứu, chuỗi CO₂ 24h, trạng thái lõi. `MockSource` dùng dữ liệu mẫu giống thiết kế, **luôn gắn nhãn "dữ liệu mẫu"** trên UI. `MqttSource` subscribe theo hợp đồng ở S6 |
| S6 | Hợp đồng MQTT | `docs/mqtt-contract.md`: topic và JSON mẫu cho từng widget, theo chuẩn roadmap đổi sang `vega/<room>/<device_id>/{state,set,meta,availability}`, thêm `vega/system/events`, `vega/system/command`, `vega/desk/core/state` |
| S7 | Môi trường MQTT để dev | `infra/docker-compose.dev.yml` chạy `eclipse-mosquitto` có listener WebSocket (cổng 9001, chỉ dùng cho dev). Script `dashboard/scripts/simulate.ts` publish dữ liệu giả theo hợp đồng |
| S8 | Thanh lệnh | Enter hoặc nút Gửi phát lệnh: bản mock chuyển sang Nghiên cứu và ghi vào Lịch sử; bản MQTT publish `vega/system/command`. Nút mic hiển thị trạng thái "Có ở Phase 6" (disabled, có `aria-label`) |
| S9 | Chế độ Lite | Theo D5. Có công tắc nhỏ trong header để bật/tắt tay |
| S10 | Xem trước lõi tròn | Route `#/core`: mô phỏng màn 240×240 với 6 trạng thái, chọn được trạng thái. Dùng làm mẫu tham chiếu khi viết firmware LVGL sau này |
| S11 | Đóng gói và CI | `dashboard/Dockerfile` (build nhiều bước → nginx:alpine), service `vega-ui` trong `infra/docker-compose.yml` (`restart: unless-stopped`, giới hạn bộ nhớ). GitHub Actions chạy lint, typecheck, test, build |
| S12 | Tài liệu | `README.md` ở gốc (chạy dev, build, mock/mqtt, lite), `docs/kiosk-pi.md` (hướng dẫn tay cài Chromium kiosk trên Pi OS Lite), brief này |

### Ngoài phạm vi (để các phase sau)

- Bộ não (agent), Telegram, gọi LLM (Phase 2).
- Mosquitto thật trên Pi: mật khẩu, ACL, TLS (Phase 1). Bản dev ở S7 **không** được dùng cho production.
- Firmware ESP / ESP32-S3, LVGL, wake word, STT/TTS (Phase 1, 6).
- Đăng nhập dashboard (Phase 7). Lấy dữ liệu thật từ Gmail, GitHub, lịch (Phase 4).
- Đẩy image lên GHCR và tự deploy lên Pi. Tự động cài kiosk trên Pi.
- Sửa tài liệu Roadmap (đổi Jarvis → VEGA): làm riêng trong phiên chính.

## 6. Definition of Done

Chỉ tính là xong khi **tất cả** các ô dưới đây được tích. Các ô đánh dấu *(Pi thật)* do chủ dự án kiểm tra sau khi merge.

### Chức năng
- [ ] `cd dashboard && npm ci && npm run dev` mở được màn Chờ với dữ liệu mẫu, nhìn giống thiết kế ở 1440×900.
- [ ] Chuyển được qua lại giữa Chờ / Nghiên cứu / Tập trung / Lịch sử bằng nav. "Mở rộng ⤢" mở Tập trung, nút × quay về Nghiên cứu, Enter trong thanh lệnh gửi được lệnh.
- [ ] Biểu đồ CO₂ đúng dữ liệu: vạch ngưỡng 1.000 ppm đúng vị trí, cột vượt ngưỡng tô cam, đỉnh 1.420 ppm ở cột 05:00 (dữ liệu mẫu).
- [ ] Ở 390×844: không có chữ đè chữ, không cuộn ngang, mọi nút bấm được.
- [ ] `?lite=1` tắt blur, drop-shadow động và hạt sáng. `prefers-reduced-motion` dừng toàn bộ animation.
- [ ] `VITE_DATA_SOURCE=mqtt` + `docker compose -f infra/docker-compose.dev.yml up` + `npm run simulate`: widget cập nhật **trong vòng 2 giây** sau khi có tin publish. Thiết bị báo `offline` thì UI hiện ngay.
- [ ] Tắt broker giữa chừng: UI hiện "mất kết nối", **không trắng màn hình**, tự kết nối lại khi broker lên lại.
- [ ] `#/core` hiển thị đủ 6 trạng thái lõi.

### Chất lượng
- [ ] `npm run lint`, `npm run check` (TypeScript strict + svelte-check), `npm test` đều qua.
- [ ] Unit test cho: máy trạng thái chế độ, `MockSource`, phần parse payload của `MqttSource` (bỏ qua JSON hỏng hoặc sai schema mà không crash).
- [ ] Smoke test Playwright: tải trang, chuyển cả 4 màn, chụp ảnh ở 1440 và 390, **không có lỗi console**.
- [ ] Trợ năng: mọi thứ bấm được đều là `<button>`/`<a>`/`<input>` thật, focus nhìn thấy được, ô lệnh có `<label>`, nút chỉ có icon có `aria-label`, chữ đạt tương phản ≥ 4.5:1.
- [ ] Bundle production: JS ≤ 120 KB gzip (không tính font).
- [ ] Không commit bí mật nào. Có `.env.example`.
- [ ] `docker build` cho `dashboard/` thành công. `docker compose -f infra/docker-compose.yml up` phục vụ được app ở cổng 8080.
- [ ] GitHub Actions xanh trên PR.

### Tài liệu và quy trình
- [ ] Có `README.md`, `docs/mqtt-contract.md`, `docs/kiosk-pi.md`, `docs/decisions/0001-vega-ui-v0.1.md`.
- [ ] Commit nhỏ, mỗi hạng mục S1–S12 ít nhất một commit.
- [ ] Mở PR vào nhánh mặc định, mô tả có checklist DoD đã tích, ảnh chụp màn 1440 và 390, và ghi rõ những ô chưa đạt kèm lý do.

### Kiểm tra trên Pi thật *(chủ dự án làm sau khi merge)*
- [ ] *(Pi thật)* Chromium kiosk trên Pi 3 chạy chế độ Lite ≥ 30 FPS, RAM trình duyệt < 400 MB sau 1 giờ.
- [ ] *(Pi thật)* Rút điện cắm lại: container `vega-ui` và kiosk tự lên.

## 7. Giả định và rủi ro

| | Nội dung | Cách xử lý |
|---|---|---|
| Giả định | Dữ liệu trên UI là dữ liệu mẫu cho tới khi Phase 1 xong | Gắn nhãn "dữ liệu mẫu" trên mọi widget dùng mock |
| Giả định | Pi 3 chạy Pi OS Lite 64-bit + Chromium kiosk | `docs/kiosk-pi.md` |
| Rủi ro | Pi 3 không đạt 30 FPS kể cả ở Lite | Lite có thể giảm thêm: tắt hẳn animation, chỉ giữ quả cầu tĩnh |
| Rủi ro | Hợp đồng MQTT phải đổi khi làm Phase 1 | Mọi parse nằm trong `MqttSource`, sửa một chỗ. Hợp đồng có số phiên bản |
| Rủi ro | Giao diện lệch khỏi thiết kế | So ảnh chụp Playwright với canvas trước khi mở PR |

## 8. Việc còn mở (không chặn bản v0.1)

- Ngôn ngữ cho bộ não: TypeScript hay Python. Gợi ý TypeScript để chung kiểu dữ liệu với `dashboard/`.
- Nhà cung cấp AI chính và trần ngân sách API mỗi tháng.
- Wake word "Hey Vega": ESP-SR không có sẵn → tự huấn luyện bằng microWakeWord, hoặc đặt hàng Espressif làm riêng, hoặc tạm dùng một câu gọi có sẵn. Cần quyết trước Phase 6.
- Đổi tên Jarvis → VEGA trong tài liệu Roadmap.
