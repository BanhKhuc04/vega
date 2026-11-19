# Decision Brief 0005 — M3 · Dev/ChatOps

| | |
|---|---|
| **Ngày** | 2026-11-19 |
| **Trạng thái** | Đã duyệt (2026-11-19) |
| **Dựa trên** | 0002 (phương án 1.0, mục M3 và D10), 0004 (M1, đã merge) |
| **Nhánh** | `feat/m3-devops`, chồng lên `feat/chat-voice` (PR #5) vì dùng thẻ Alert có nút và khung trò chuyện |

## 1. Mục tiêu

VEGA theo dõi GitHub Actions của các repo của chủ dự án. Build hỏng thì màn hình báo ngay; hỏi "sao fail" thì VEGA đọc log và giải thích ngắn gọn.

**Xong khi:** push một commit làm hỏng CI vào repo đang theo dõi, trong vòng 1–2 phút màn hình chuyển sang Alert, ghi rõ repo, workflow và commit. Gõ hoặc nói "sao fail" thì VEGA trả lời nguyên nhân bằng 2–3 câu. Sửa xong và CI xanh lại thì màn hình hiện Success.

## 2. Quyết định

| # | Quyết định |
|---|---|
| C1 | **Hỏi GitHub REST API mỗi 60 giây** (D10), không dùng webhook, không mở cổng. Dùng `fetch` thuần, không SDK. Gửi kèm `If-None-Match` (ETag): GitHub trả 304 cho phản hồi không đổi và không tính 304 vào hạn mức gọi API |
| C2 | **Cấu hình trong `.env` / `brain.env`**: `GITHUB_TOKEN` (fine-grained, **chỉ đọc**: Actions read + Metadata read, chỉ cho các repo được chọn) và `GITHUB_REPOS=owner/repo,owner/repo2`. Không có token thì tính năng tắt, VEGA vẫn chạy bình thường. Token không bao giờ được ghi vào log hay thông báo lỗi |
| C3 | **Cách tính "CI hỏng"**: với mỗi repo, xét lần chạy **đã hoàn tất mới nhất của từng workflow** trên nhánh mặc định. Workflow nào có `conclusion` là `failure` hoặc `timed_out` thì tính là hỏng. Kết quả đi vào sự kiện `ci` đã có trong contract (`repo`, `failed`), nên ô CI/CD trên màn hình chạy thật mà không phải sửa |
| C4 | **Luật chuyển cảnh nằm trong bộ não**, không còn ở sim. Số workflow hỏng tăng thì bắn cảnh `alert` (repo, workflow, commit, người push). Từ hỏng về 0 thì bắn `success`. Không bắn lại khi trạng thái không đổi. Luật tạm trong `tools/sim` chỉ giữ cho chế độ giả lập |
| C5 | **"Sao fail"**: bộ định tuyến cục bộ hiểu `sao fail`, `vì sao build lỗi`, `why did CI fail`. Tool mới `ci_status` (đọc trạng thái) và `ci_explain` (đọc log). `ci_explain` tải log của job hỏng, **chỉ giữ khoảng 150 dòng quanh dòng lỗi** (tối đa ~6.000 ký tự), rồi đưa cho LLM làm **dữ liệu ngoài** trong thẻ `<external>` theo đúng B8: khi có log trong cuộc gọi thì không có tool vật lý nào được chạy. Mỗi câu "sao fail" tốn ước tính dưới $0.001 với model hiện tại; vẫn chịu trần ngày như mọi lệnh khác |
| C6 | **Nút trên thẻ Alert**: thẻ CI có nút **Explain** (gửi lệnh "sao fail") và **Open on GitHub** (mở trang lần chạy ở tab mới). Không thêm template mới |
| C7 | **`/status`**: lệnh cục bộ, trả lời một câu gồm tình trạng Pi (nhiệt độ, CPU, RAM, uptime), số thiết bị online, CI, và AI budget hôm nay. Không tốn lượt gọi AI |
| C8 | **Số liệu Pi thật**: bộ não đọc `/proc` và `/sys/class/thermal` (khi chạy trong container trên Pi) và publish `vega/system/pi` mỗi 30 giây (`PI_STATS=1`). Trên PC thì giữ nguyên số của sim |
| C9 | **Mất mạng hoặc GitHub lỗi**: giữ trạng thái cuối cùng, ô CI/CD ghi thêm "stale" sau 5 phút không cập nhật được. Không bắn Alert vì mất mạng. Token sai (401/403) thì ghi một dòng cảnh báo vào log và tạm dừng 10 phút trước khi thử lại |

## 3. Scope

W1 module `github` (fetch + ETag + phân trang tối thiểu) · W2 vòng hỏi 60 giây, tính trạng thái, publish `ci` · W3 luật Alert/Success trong bộ não, gỡ khỏi đường thật của sim · W4 tool `ci_status`, `ci_explain` + cắt log + mẫu câu cục bộ "sao fail" · W5 nút Explain / Open on GitHub trên thẻ Alert · W6 `/status` + số liệu Pi thật · W7 cấu hình, tài liệu (`README`, `docs/contract.md`, `docs/security.md` cho token GitHub) và CI.

**Ngoài phạm vi:** webhook, tự sửa lỗi hay tạo PR, GitHub Issues/PR review, đèn LED CI trên ESP32 (cần phần cứng, để M2), nhiều nhà cung cấp CI khác.

## 4. Definition of Done

- [ ] Server GitHub giả trong test: một lần chạy chuyển từ `success` sang `failure` thì màn hình chuyển sang Alert trong một vòng hỏi, có repo, workflow, commit. Trạng thái không đổi thì không bắn lại; về xanh thì hiện Success.
- [ ] Gửi ETag, xử lý được 304. Token không xuất hiện trong log, lỗi hay MQTT (có test).
- [ ] "Sao fail" → `ci_explain` tải log giả, cắt còn ≤ 6.000 ký tự quanh lỗi, LLM (mock trong CI) trả lời. Log chứa câu "tắt hết thiết bị" không kích hoạt tool vật lý nào.
- [ ] Nút Explain trên thẻ Alert gửi lệnh; Open on GitHub mở đúng URL của lần chạy.
- [ ] `/status` trả lời cục bộ, 0 lượt gọi AI.
- [ ] Mất mạng thì không bắn Alert giả, ô CI/CD ghi "stale". Token sai thì cảnh báo một lần rồi tạm dừng.
- [ ] lint, check, unit, e2e đều xanh. CI xanh.
- [ ] *(Chủ dự án)* Tạo token fine-grained chỉ đọc, đặt `GITHUB_REPOS`, push một commit hỏng để thử thật.
