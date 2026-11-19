# Decision Brief 0007 — M6 · Nghiên cứu có nguồn

| | |
|---|---|
| **Ngày** | 2026-11-19 |
| **Trạng thái** | Chờ duyệt |
| **Dựa trên** | 0002 (phương án 1.0, mục M6, màn Research, D4, D6), 0004 (M1), 0006 (M4, đã merge) |
| **Nhánh** | `feat/m6-research`, từ `main` |

## 1. Mục tiêu

Hỏi VEGA một câu cần tra cứu, ví dụ "so sánh 3 loại cảm biến CO₂ rẻ nhất cho ESP8266" hay "Pi 4 chạy Whisper được không".
VEGA tìm trên web, đọc vài nguồn, rồi trả lời ngắn gọn kèm số trích dẫn `[1] [2] [3]`. Mỗi số trỏ tới một trang thật, bấm vào
mở được. Mỗi lần nghiên cứu có trần chi phí riêng, và vẫn chịu trần ngày như mọi lệnh khác.

**Xong khi:** gõ hoặc nói `nghiên cứu …`, màn hình chuyển sang Research và hiện từng bước (lên kế hoạch, tìm, đọc, viết). Câu trả
lời trong khung chat có **ít nhất 3 nguồn kiểm tra được**, thuộc ít nhất 3 trang web khác nhau, bấm vào là mở. VEGA đọc to phần
tóm tắt, không đọc danh sách nguồn.

## 2. Quyết định

| # | Quyết định |
|---|---|
| R1 | **Tìm web bằng Tavily** (`TAVILY_API_KEY`). Gói miễn phí 1.000 credit mỗi tháng, không cần thẻ; mỗi lần tìm cơ bản tốn 1 credit. Tavily trả về luôn phần chữ chính của mỗi trang, nên bộ não **không tự tải trang web nào** (không có rủi ro bộ não bị dụ gọi tới địa chỉ nội bộ). Lớp `search` viết trung lập như lớp `llm`, để sau này thêm Brave hoặc SearXNG chỉ là thêm một provider. Brave hiện đòi thẻ tín dụng và tính tiền theo lượt nên không chọn làm mặc định |
| R2 | **Đếm lượt tìm theo tháng** trong SQLite, trần `SEARCH_MAX_MONTH` (mặc định 900, chừa lề dưới 1.000 credit miễn phí). Hết lượt thì từ chối nghiên cứu, nói rõ khi nào có lượt lại. Lượt tìm không bao giờ vượt trần, kể cả khi LLM gọi nhiều lần |
| R3 | **Hai mức.** (a) **Nghiên cứu**: kích hoạt bằng `nghiên cứu …`, `tìm hiểu …`, `so sánh …`, `research …`, hoặc `/research …`. LLM đề ra tối đa 3 câu tìm, bộ não tìm, giữ tối đa 8 nguồn (mỗi nguồn cắt còn khoảng 1.500 ký tự), rồi LLM viết câu trả lời có trích dẫn. (b) **Tra nhanh**: trong câu hỏi thường, LLM được dùng tool `web_search` (1 lần tìm, 5 kết quả ngắn) khi cần thông tin mới, ví dụ giá, tin tức. Tối đa 1 lần tìm cho mỗi lệnh |
| R4 | **Trần chi phí mỗi lần nghiên cứu** `RESEARCH_MAX_USD` (mặc định $0.01). Trước mỗi lượt gọi LLM, bộ não ước tính chi phí theo số ký tự và giá của provider. Nếu vượt trần thì bớt nguồn, bớt độ dài nguồn; vẫn vượt thì dừng và trả lời bằng những gì đã có. Model dùng task `research` (D4): `LLM_RESEARCH`, mặc định là provider của `chat`. Trần token đầu ra riêng cho lượt viết là `RESEARCH_MAX_OUTPUT_TOKENS` (mặc định 800). Câu trả lời ghi rõ chi phí và số nguồn |
| R5 | **Trích dẫn kiểm tra được**: LLM trả về JSON (`answer`, `summary`, `cites`, tuỳ chọn `compare`). Bộ não kiểm tra mọi số `[n]` có trong danh sách nguồn đã tìm. Số bịa thì bị xoá. URL chỉ lấy từ kết quả tìm và phải là `https`, không lấy URL do LLM tự viết. Dưới 3 nguồn từ 3 trang khác nhau thì câu trả lời nói rõ "chỉ tìm được N nguồn", không giả là đủ |
| R6 | **Contract**: `command_result` thêm `sources` (tuỳ chọn, tối đa 8 `{ n, title, url }`, url chỉ `https`); `result` tăng giới hạn từ 500 lên 2.000 ký tự, vì câu trả lời có trích dẫn dài hơn. Khung chat hiện nguồn thành link (mở tab mới, `noopener`, chữ đưa vào bằng `textContent`). Giọng đọc chỉ đọc `summary` (2–3 câu). Tăng `CONTRACT_VERSION` lên 4 |
| R7 | **Màn Research** dùng các trường đã có trong `researchData`: `title` (câu hỏi), `steps` (Plan → Search ×N → Read → Write), `step`, `stat.sources`, `source` (trang đang đọc), `log` (câu tìm, tên miền), `note` (tóm tắt + `[1] [2] [3]`). Câu hỏi so sánh thì hiện thêm bảng `compare` (≤ 4 cột, ≤ 8 dòng). Không thêm template mới |
| R8 | **Trang web là dữ liệu ngoài**: nội dung nguồn vào LLM trong thẻ `<external source="web">`, và lượt đó **không có tool hành động nào** (thiết bị, cảnh, lời nhắc). Lịch và mail cũng không được đưa vào lượt nghiên cứu, để một trang web không thể dụ VEGA chép dữ liệu cá nhân vào câu tìm |
| R9 | **Câu hỏi được gửi tới Tavily và nhà cung cấp AI.** README ghi rõ điều này. Không có `TAVILY_API_KEY` thì VEGA trả lời "chưa bật tìm web", 0 lượt gọi. Mất mạng hoặc hết ngân sách ngày thì nói rõ, không trả lời bừa |

## 3. Scope

W1 lớp `search` + client Tavily, đếm lượt theo tháng · W2 luồng nghiên cứu: lên kế hoạch, tìm, chọn và cắt nguồn, ước tính chi phí ·
W3 viết câu trả lời: JSON, kiểm trích dẫn, ≥ 3 nguồn, tóm tắt để đọc to · W4 contract `command_result.sources` + khung chat hiện link ·
W5 màn Research theo từng bước, bảng so sánh · W6 câu kích hoạt cục bộ + tool `web_search` cho tra nhanh · W7 cấu hình, tài liệu
(`README`, `docs/contract.md`, `docs/security.md`), e2e với Tavily giả.

**Ngoài phạm vi:** tự tải và đọc trang web (ngoài phần Tavily trả về), đọc PDF, biểu đồ số liệu từ nguồn (`chart` hiện chỉ hợp với
chuỗi CO₂), nghiên cứu chạy nền nhiều phút, nhớ các lần nghiên cứu trước, provider tìm kiếm thứ hai.

## 4. Definition of Done

- [ ] Tavily giả + LLM giả: `nghiên cứu …` → màn Research đi qua Plan, Search, Read, Write; câu trả lời có ≥ 3 trích dẫn trỏ tới 3
  trang khác nhau; khung chat hiện 3 link `https` bấm được; giọng đọc chỉ đọc phần tóm tắt.
- [ ] LLM bịa `[9]` hoặc tự viết URL: số đó bị xoá, không URL lạ nào lọt vào câu trả lời. Chỉ có 2 trang: câu trả lời nói "chỉ tìm
  được 2 nguồn".
- [ ] Trần mỗi lần nghiên cứu được giữ: nguồn bị bớt cho vừa trần; sổ chi phí ghi đúng từng lượt gọi. Hết lượt tìm của tháng thì từ
  chối, 0 lượt gọi Tavily.
- [ ] Nội dung trang web chứa "tắt hết thiết bị" không bật/tắt thiết bị nào, không tạo lời nhắc nào.
- [ ] Không có `TAVILY_API_KEY`: trả lời rõ ràng, 0 lượt gọi AI hay Tavily. `TAVILY_API_KEY` không nằm trong log, lỗi hay MQTT (có test).
- [ ] Câu hỏi thường cần thông tin mới: LLM dùng `web_search` tối đa 1 lần, câu trả lời có nguồn.
- [ ] lint, check, unit, e2e đều xanh. CI xanh.
- [ ] *(Chủ dự án)* Tạo key Tavily, hỏi một câu nghiên cứu thật, mở từng link nguồn để kiểm.

## 5. Việc của chủ dự án

1. Tạo tài khoản ở tavily.com (gói miễn phí, không cần thẻ), lấy API key.
2. Thêm `TAVILY_API_KEY=` vào `.env`. Tuỳ chọn: `RESEARCH_MAX_USD`, `SEARCH_MAX_MONTH`.

## 6. Câu hỏi mở

1. **Trần mỗi lần nghiên cứu $0.01** là ước tính theo giá model hiện tại (DeepSeek qua gwai, $0.30 / $1.20 cho 1 triệu token):
   khoảng 8 nguồn × 1.500 ký tự cộng câu trả lời 800 token vẫn dưới $0.01. Với trần ngày $0.05, một ngày chạy được khoảng 4–5
   lần nghiên cứu nếu không dùng AI cho việc khác. Muốn nhiều hơn thì tăng `BUDGET_USD_DAY`.
2. **Chỉ đọc phần chữ Tavily trích ra**: nhanh và an toàn, nhưng trang cần đăng nhập, trang chạy bằng JavaScript nặng, hoặc PDF có
   thể bị thiếu nội dung. Tự tải trang để sau, nếu thấy thiếu.
3. **Tăng `command_result` lên 2.000 ký tự** làm màn hình bản cũ (trước PR này) từ chối câu trả lời dài. Tất cả màn hình đều build từ
   cùng repo nên chỉ cần cập nhật một lần.
