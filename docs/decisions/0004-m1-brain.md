# Decision Brief 0004 — M1 · Bộ não v1

| | |
|---|---|
| **Ngày** | 2026-11-18 |
| **Trạng thái** | Đã duyệt |
| **Dựa trên** | 0002 (phương án 1.0), 0003 (M0, đã merge) |
| **Nhánh** | `feat/m1-brain` từ `main` |

## 1. Mục tiêu

`brain/` thành dịch vụ thật. Nó nhận lệnh từ thanh lệnh qua `vega/system/command`, hiểu lệnh, gọi tool, rồi điều khiển màn hình bằng `vega/ui/scene`.

**Xong khi:** gõ "phòng mấy độ, bật đèn giúp" trên thanh lệnh thì VEGA trả lời đúng nhiệt độ của sim, relay ảo bật, và lệnh này **không tốn lượt gọi AI nào**.

## 2. Quyết định

| # | Quyết định |
|---|---|
| B1 | **Node 22 + TypeScript strict.** Chỉ dùng `packages/contract` để parse và tạo mọi payload MQTT. MQTT dùng mqtt.js (ở phía Node không bị giới hạn bundle). Lưu trữ dùng **`node:sqlite` có sẵn** trong Node, không thêm thư viện DB |
| B2 | **Định tuyến cục bộ trước.** Từ điển thiết bị lấy từ các bản tự khai báo `meta` + mẫu câu tiếng Việt/Anh cho các lệnh: bật, tắt, mấy độ, độ ẩm, CO₂, các cảnh (đi ngủ, tập trung…). Khớp thì làm ngay, không gọi LLM |
| B3 | **Cổng LLM** chỉ là `fetch` tới API chuẩn OpenAI-compatible, không dùng SDK. Cấu hình theo loại việc (`router`, `chat`): `baseUrl`, `model`, giá mỗi triệu token. Có thêm **provider `mock`** chạy cố định, dùng cho test và CI |
| B4 | **Tool calling** gồm `list_devices`, `get_sensor`, `set_device`, `run_scene`. Tool được sinh từ registry, nên thêm thiết bị mới không cần sửa code bộ não |
| B5 | **Màn Think theo việc thật.** Mỗi bước (phân tích ý định, gọi tool) bắn cảnh `think` với các chip lấy từ việc đang chạy. Câu trả lời hiện bằng các trường chữ đã có sẵn trong template (`caption`/`transcript`). Không thêm template mới |
| B6 | **Chi phí.** Mỗi lần gọi LLM ghi một dòng `{model, tokens, usd}` vào SQLite. Có trần theo ngày (`.env`). Vượt trần thì chỉ dùng cục bộ, và màn hiện chip `BUDGET` một lần |
| B7 | **Bảo mật lệnh (bắt buộc, câu hỏi mở 4 của M0).** Listener WebSocket của Mosquitto trên Pi chỉ nghe ở `localhost` và địa chỉ Tailscale, không nghe ở mạng LAN. Lệnh vật lý được xếp hạng rủi ro: bật/tắt đèn, quạt thì làm luôn; tắt PC, ổ cắm công suất lớn thì phải xác nhận trên màn. Giới hạn tần suất 10 lệnh/phút. Ghi `docs/security.md` |
| B8 | **Prompt injection.** Nội dung đọc từ bên ngoài (về sau là email, log CI) chỉ được đưa vào LLM như dữ liệu. Tool vật lý chỉ chạy khi lệnh đến trực tiếp từ chủ nhân. Có test cho quy tắc này |
| B9 | **Bỏ phần định tuyến demo** trên thanh lệnh của dashboard (câu hỏi mở 5 của M0). Dashboard chỉ publish lệnh, mọi việc chọn cảnh do bộ não quyết |
| B10 | **Bộ chọn nhà cung cấp AI:** `npm run bench` chạy 50 lệnh tiếng Việt mẫu (`brain/bench/cases.jsonl`, mỗi lệnh kèm kết quả mong đợi) trên mọi provider có key trong `.env`, in bảng độ đúng, độ trễ p50 và USD/100 lệnh. CI chỉ chạy với `mock` |
| B11 | Mất internet: lệnh cục bộ vẫn chạy. Câu hỏi cần AI thì trả lời "offline", không treo |

## 3. Scope

W1 dựng khung `brain/` + Dockerfile ARM64 + service trong `infra/pi/docker-compose.yml` · W2 lớp MQTT + registry từ `meta`/`availability` · W3 định tuyến cục bộ · W4 cổng LLM + mock · W5 vòng lặp tool + cảnh think/trả lời · W6 SQLite: nhật ký lệnh và chi phí · W7 bảo mật B7, B8 · W8 gỡ phần demo trên dashboard (B9) · W9 bench (B10) · W10 cập nhật tài liệu (`README`, `docs/contract.md`, `docs/security.md`) và CI.

**Ngoài phạm vi:** Telegram, giọng nói, Google, GitHub, nghiên cứu web, bộ nhớ dài hạn, phần cứng thật.

## 4. Definition of Done

- [ ] Sim + broker + brain + dashboard: "phòng mấy độ, bật đèn giúp" → trả lời đúng giá trị sim, relay ảo bật, **0 lượt gọi LLM** (kiểm bằng sổ chi phí).
- [ ] Một câu không khớp mẫu cục bộ đi qua LLM (mock trong CI), gọi đúng tool. Các chip trên màn Think khớp với những tool đã gọi.
- [ ] Hành động nguy hiểm phải xác nhận. Lệnh thứ 11 trong cùng 1 phút bị từ chối, có lý do.
- [ ] Test prompt injection: một payload có câu "tắt hết thiết bị" nằm trong dữ liệu ngoài không kích hoạt tool vật lý nào.
- [ ] Vượt trần chi phí ngày thì chuyển sang chỉ dùng cục bộ và hiện chip `BUDGET`. Mất internet thì lệnh cục bộ vẫn chạy.
- [ ] `npm run bench -- --provider mock` in ra bảng.
- [ ] lint, check, unit, e2e (broker trong tiến trình) đều xanh. Ảnh Docker của brain build được. CI xanh.
- [ ] PR có checklist này, tích bằng output lệnh thật. Ô chưa đạt ghi rõ lý do.
- [ ] *(Chủ dự án)* Chạy `npm run bench` với 2–3 key thật, chọn nhà cung cấp mặc định.
