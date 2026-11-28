# Decision Brief 0019: M15 AI cục bộ trên PC (Ollama)

| | |
|---|---|
| **Ngày** | 2026-11-28 |
| **Trạng thái** | Bản nháp. Code và test xong; bench model cục bộ còn chờ chủ dự án cài Ollama (mục 5) |
| **Dựa trên** | 0012 (R4 không chạy model sinh chữ trên Pi, mốc M15), 0002 (D4 cổng LLM trung lập, D6 trần chi phí), 0004 (bench 50 lệnh), 0017 (Tailscale trên PC, cổng Tailscale) |
| **Sửa** | 0002 D4: ngoài `https://` và `http://localhost`, provider được dùng `http://` tới địa chỉ Tailscale `100.64.0.0/10` (đường truyền đã mã hoá bằng WireGuard) |
| **Nhánh** | `feat/m15-local-ai`, từ `main` |

## 1. Vấn đề

Hết `BUDGET_USD_DAY` hoặc mất internet thì VEGAS chỉ còn lệnh cục bộ: hỏi gì ngoài mẫu cũng nhận "Daily AI budget reached" hoặc
"Offline". PC của chủ (i7-12700H, 32 GB RAM, RTX 3050 Laptop 4 GB) bật vài giờ mỗi ngày và chạy được model 3–4B. R4 cấm chạy model
sinh chữ trên Pi, nên model cục bộ phải ở PC.

## 2. Quyết định

| # | Quyết định |
|---|---|
| L1 | **Ollama là một provider OpenAI-compatible như mọi provider khác** (D4): `LLM_OLLAMA_BASE_URL`, `_MODEL`, `_PRICE_IN=0`, `_PRICE_OUT=0`. Thêm preset `ollama` = `http://localhost:11434/v1` cho lúc chạy bộ não ngay trên PC (`npm run vega`). Không thêm SDK |
| L2 | **`LLM_LOCAL=<tên provider>` chỉ ra model của PC.** Không đặt thì mọi thứ như cũ |
| L3 | **Định tuyến** (`brain/src/agent.ts`, mỗi lượt gọi AI): việc `chat` (viết câu trả lời sau khi tool chạy) đi PC khi PC bật. Việc `router` (chọn tool) vẫn đi cloud vì cloud gọi tool chính xác hơn. **Mọi việc** đi PC khi cloud không dùng được: không có provider cloud, hết trần ngày, hoặc vừa mất mạng. Gọi PC không bị trần ngày chặn (giá 0, máy của chủ) |
| L4 | **PC tắt thì như hôm nay:** cloud, hoặc chỉ lệnh cục bộ. Không bao giờ bật PC (không Wake-on-LAN) chỉ để trả lời một câu |
| L5 | **Dò PC rẻ và có cache:** `GET <base>/models`, timeout 1,5 s, nhớ kết quả 60 s. Dò bắt đầu song song với lượt gọi cloud đầu tiên nên khi cloud còn dùng được thì gần như không thêm độ trễ. PC tắt thì tệ nhất thêm 1,5 s cho một lệnh mỗi phút |
| L6 | **Lỗi giữa chừng:** gọi PC lỗi (PC vừa tắt, model lỗi) thì coi PC tắt tới lần dò sau và làm lại lượt đó theo cách cũ. Gọi cloud báo mất mạng mà PC bật thì làm lại lượt đó trên PC, và trong 60 s sau đó đi thẳng PC, không chờ cloud timeout |
| L7 | **Chip `LOCAL AI` trên header** khi câu trả lời gần nhất do model PC viết. `command_result` có thêm `local_ai: true` (hợp đồng v10). Lệnh cục bộ hay câu trả lời từ cloud thì chip ẩn |
| L8 | **Chỉ việc nhẹ:** nghiên cứu (M6) và nhìn ảnh (M7) không chuyển sang PC. Bí danh và quy tắc riêng tư của M9 áp dụng như với cloud (đơn giản hơn là có ngoại lệ) |
| L9 | **Mạng:** Ollama không có mật khẩu. Ollama nghe ở **địa chỉ Tailscale của PC** (`OLLAMA_HOST=100.x.y.z:11434`), không nghe `0.0.0.0`. Bộ não gọi `http://100.x.y.z:11434/v1`. Không dùng `tailscale serve`: Ollama nghe ở loopback thì trả 403 cho Host lạ như `*.ts.net` (kiểm `allowedHostsMiddleware` trong `server/routes.go`) |

## 3. Chọn model

Ứng viên (lấy từ trang thư viện Ollama ngày 2026-11-28):

| Model | Tải về | Ghi chú |
|---|---|---|
| `qwen3:4b-instruct-2507-q4_K_M` | 2,5 GB | Ứng viên chính. Bản instruct, không suy nghĩ dài (`thinking`) nên trả lời nhanh và không tốn `MAX_OUTPUT_TOKENS`. Vừa 4 GB VRAM |
| `qwen2.5:3b` (q4_K_M) | 1,9 GB | Để so sánh, nhẹ hơn |

Không dùng bản `qwen3:4b` lai (mặc định bật suy nghĩ): chậm hơn nhiều cho câu ngắn.

Cách đo: `npm run bench -- --provider ollama` (cùng 50 lệnh của 0004, bỏ qua bộ định tuyến cục bộ). Nên đặt `OLLAMA_KEEP_ALIVE=30m` để
model không bị gỡ khỏi bộ nhớ giữa các lệnh.

## 4. Định nghĩa xong

- [x] Test: hết trần + PC bật → PC trả lời; PC tắt → như hôm nay (budget, offline, no_llm); mất mạng + PC bật → PC trả lời; PC tắt
  giữa chừng → làm lại bằng cloud; dò PC có cache; chip `LOCAL AI`. Test chạy với server OpenAI-compatible giả (`brain/tests/fakeollama.ts`)
- [x] `npm run lint`, `npm run check`, `npm test` xanh
- [ ] **Bench model cục bộ ≥ 85% gọi tool đúng:** chưa đo, xem mục 5
- [ ] Đo trên Pi thật: Pi 4 gọi PC qua Tailscale. Chưa làm vì cả hai Pi đang không vào được

## 5. Kết quả bench

**Chưa có.** Máy PC chưa cài Ollama (`ollama --version` không có). Theo quy tắc, cài phần mềm hệ thống và tải model lớn phải hỏi chủ
dự án. Khi chủ đồng ý: cài Ollama cho Windows, `ollama pull qwen3:4b-instruct-2507-q4_K_M` (2,5 GB) và, để so sánh,
`ollama pull qwen2.5:3b` (1,9 GB), rồi chạy bench và ghi bảng vào đây. Không đạt 85% thì L3 lùi lại: PC chỉ làm việc `chat`, còn chọn
tool khi hết trần hoặc mất mạng vẫn trả "local commands only" như cũ.

## 6. Rủi ro

1. **Model 4B gọi nhầm tool.** Lệnh vật lý vẫn qua các lớp cũ: chỉ lệnh trực tiếp của chủ, thiết bị rủi ro cao phải Confirm. Bench quyết
   định có cho model PC chọn tool hay không (mục 5).
2. **Lần gọi đầu chậm** vì Ollama phải nạp model (vài giây trên GPU). `LLM_TIMEOUT_MS` (20 s) vẫn áp dụng; quá thì làm lại bằng cloud.
3. **Ai trong tailnet cũng gọi được Ollama.** Tailnet chỉ có máy của chủ. Muốn chặt hơn thì thêm ACL Tailscale chỉ cho Pi 4 vào cổng
   11434 (`docs/security.md`).
