# Decision Brief 0010 — M7 · Vision: "Trên bàn có gì?"

| | |
|---|---|
| **Ngày** | 2026-11-21 |
| **Trạng thái** | Đã duyệt (2026-11-21) |
| **Dựa trên** | 0002 (D4 cổng LLM có việc `vision`, D8 chỉ chụp khi được gọi, D9 rút được phần cứng, D11 giả lập), 0004 (bộ não, tool), 0008 (HTTP của bộ não sau nginx) |
| **Nhánh** | `feat/m7-vision`, từ `main` |

## 1. Vấn đề

Màn Vision hiện là cảnh **vẽ sẵn**: một mặt bàn giả, khung và nhãn cố định (`dashboard/src/vision.js`). Pi 4 giờ đã chạy VEGA
(stack lên ngày 2026-11-21, `https://vega.taila01e39.ts.net`) và có camera USB thật: Jieli `1224:2a25` ở `/dev/video0`, MJPEG tới
1920×1080 30 fps, chụp thử 1280×720 được (khoảng 110 KB một khung).

Còn thiếu cả đường đi: chụp khi được gọi → model thị giác → khung và nhãn → màn Vision vẽ ảnh thật; rút camera thì VEGA nói rõ.

## 2. Mục tiêu

**Xong khi:** hỏi "trên bàn có gì?" (gõ, hoặc "Hey Jarvis, trên bàn có gì?") thì trong khoảng 6 giây màn Vision hiện **ảnh vừa chụp**
từ camera trên Pi, có khung và nhãn tiếng Việt cho các vật trên bàn, và VEGA trả lời một câu ngắn ("Laptop, cốc cà phê, bo mạch
ESP8266 và cuộn dây"). Rút camera rồi hỏi lại thì VEGA đáp "Camera đang rút" và màn Vision hiện **Camera unplugged**. Không ảnh nào
được ghi xuống đĩa.

## 3. Quyết định

| # | Quyết định |
|---|---|
| V1 | **Bộ não tự chụp, không thêm dịch vụ.** Container bộ não cài `v4l-utils` và chụp một khung MJPEG bằng `v4l2-ctl` (bỏ vài khung đầu để camera tự chỉnh sáng), đúng cách đã thử tay trên Pi. Không OpenCV, không ffmpeg. Thiết bị: `CAMERA_DEVICE` (mặc định `/dev/video0`), độ phân giải `CAMERA_SIZE` (mặc định `1280x720`) |
| V2 | **Cắm/rút lúc nào cũng được (D9).** Compose bind `/dev` vào container bộ não kèm `device_cgroup_rules: ['c 81:* rmw']` (81 là major của video4linux) thay cho `devices:`. `devices:` làm container **không khởi động được** nếu lúc đó camera đang rút |
| V3 | **Model thị giác qua cổng LLM có sẵn (D4):** việc mới `vision`, chọn bằng `LLM_VISION=<provider>` như `LLM_RESEARCH`. Gửi ảnh dạng `image_url` (data URL base64) theo chuẩn OpenAI, xin JSON `{summary, objects: [{label, box: [x, y, w, h]}]}`, toạ độ chuẩn hoá 0–1. Kiểm tra JSON; khung sai hoặc ngoài ảnh thì bỏ khung đó, không bỏ cả câu trả lời. Không đặt `LLM_VISION` thì lệnh Vision trả lời "chưa cấu hình model thị giác" |
| V4 | **Chỉ chụp khi được gọi (D8).** Lệnh cục bộ (0 đồng cho phần hiểu câu): "trên bàn có gì", "camera thấy gì", "nhìn xem", "what's on the desk". Tool `look(question?)` cho AI chat, để câu như "cái cốc màu gì?" gửi kèm câu hỏi tới model thị giác. Không có chế độ quay liên tục |
| V5 | **Ảnh không rời bộ nhớ.** Bộ não giữ **một** khung gần nhất trong RAM, có mã ngẫu nhiên, hết hạn sau 120 giây hoặc khi có khung mới. Phục vụ ở `GET /vision/frame/<id>` (cùng HTTP server với `/voice/stt`, nginx thêm route `/vision/`). Ảnh **không** đi qua MQTT (cảnh retained sẽ giữ ảnh trong broker). Log chỉ ghi giờ, số byte, chi phí |
| V6 | **Cảnh `vision` mở rộng (contract v6):** `visionData` thêm `frame` (đường dẫn), `summary`, `objects[]` (`label`, `box`, `conf` tuỳ chọn), `status: "ok" \| "unplugged" \| "offline" \| "off"`. Bản cũ chỉ có `camera` vẫn hợp lệ |
| V7 | **Màn Vision vẽ ảnh thật:** có `frame` thì `vision.js` vẽ ảnh lên `#feed` và vẽ khung + nhãn bằng chính kiểu callout đang có, đếm số vật. Không có `frame` (mock, demo, `?sample`) thì giữ cảnh vẽ sẵn như hiện tại. `status: unplugged` thì hiện **Camera unplugged** |
| V8 | **Trạng thái camera lên header:** bộ não kiểm tra thiết bị mỗi 5 giây và publish retained `camera: "on" \| "missing"` (cùng chỗ với `mic` trong trạng thái `core`, hoặc topic riêng nếu gộp vào `core` gây tranh chấp với pc-agent; chọn khi code). Rút camera thì chip **CAM OFF** |
| V9 | **Chi phí có trần:** mỗi lần nhìn được tính vào `BUDGET_USD_DAY` như mọi lượt AI, thêm trần số lần `VISION_MAX_DAY` (mặc định 50). Hết trần thì trả lời rõ, không chụp |
| V10 | **Giả lập cho PC và CI (D11):** `CAMERA=sim` dùng một ảnh mẫu trong repo thay cho `v4l2-ctl`. `npm run vega` trên PC mặc định dùng sim; test dùng model thị giác giả |

## 4. Scope

W1 chụp ảnh (`v4l2-ctl`, sim, phát hiện cắm/rút, compose) · W2 cổng LLM gửi ảnh (`/chat/completions` và `/responses`), việc `vision`,
kiểm tra JSON · W3 lệnh cục bộ + tool `look`, trần chi phí · W4 `/vision/frame/<id>` trong RAM, nginx · W5 contract v6 · W6 màn Vision
vẽ ảnh thật, chip CAM OFF · W7 test, README, `docs/contract.md`, `docs/security.md`, `docs/pi-setup.md`.

**Ngoài phạm vi:** camera IP (RTSP), quay liên tục hay phát hiện chuyển động, nhận diện khuôn mặt hoặc người, lưu lịch sử ảnh,
model thị giác chạy trên Pi (xem câu hỏi mở 2), lật/xoay ảnh theo cách gắn camera (thêm sau nếu cần).

## 5. Definition of Done

- [ ] Unit test (camera giả, model giả): lệnh "trên bàn có gì" → chụp → gọi model → cảnh `vision` có `frame`, `objects`, `summary`;
      JSON hỏng hoặc khung ngoài ảnh không làm hỏng câu trả lời; camera rút → "Camera đang rút", không gọi model; hết trần → không chụp.
- [ ] `/vision/frame/<id>`: trả JPEG đúng mã; mã sai hoặc hết hạn → 404; không file nào được ghi ra đĩa trong cả lượt.
- [ ] Contract v6 có schema và test; cảnh `vision` cũ vẫn hợp lệ.
- [ ] e2e dashboard: cảnh `vision` có `frame` thì hiện ảnh và đúng số khung; `status: unplugged` hiện Camera unplugged; `camera: missing`
      hiện chip CAM OFF; không `frame` thì vẫn là cảnh vẽ sẵn.
- [ ] lint, check, unit, e2e, test Python đều xanh. CI xanh (gồm image arm64 của bộ não có `v4l-utils`).
- [ ] *(Chủ dự án)* Trên Pi, hỏi "trên bàn có gì?": ảnh thật kèm nhãn đúng trong khoảng 6 giây.
- [ ] *(Chủ dự án)* Rút camera khi VEGA đang chạy: chip CAM OFF trong 10 giây, hỏi lại thì được trả lời rõ; cắm lại thì dùng tiếp, không
      phải khởi động lại gì.

## 6. Việc của chủ dự án

1. Gắn camera nhìn xuống mặt bàn, cách khoảng 40–60 cm. Ảnh chụp thử hiện đang nghiêng và quá sát.
2. Chọn nhà cung cấp có model thị giác (câu hỏi mở 1), thêm khối `LLM_<TÊN>_*` và `LLM_VISION=<tên>` vào `infra/pi/brain.env`.
3. Sau khi merge: `cd ~/vega && git pull && sudo ./infra/pi/setup.sh --no-kiosk` trên Pi để build lại.

## 7. Câu hỏi mở

1. **Model thị giác nào?** Cần model nhìn ảnh **và** trả khung đối tượng ổn định. Đề xuất: thử 2–3 model rẻ có API kiểu OpenAI (ví dụ
   dòng Gemini Flash, Qwen-VL) trên 10 ảnh bàn chụp từ camera này, so độ đúng của nhãn, độ chính xác của khung, độ trễ và giá, giống
   cách chọn model ở M1. Ước tính một ảnh 1280×720 khoảng $0.0002–0.001, tức dưới $0.05 cho 50 lần/ngày. Provider hiện tại trên Pi
   (`GWAI`) chưa rõ có nhận ảnh không: sẽ thử trước.
2. **Chạy model trên Pi thay cho cloud?** YOLO nhỏ (ONNX) chạy được trên Pi 4 khoảng 1 giây, miễn phí, ảnh không rời nhà, nhưng chỉ biết
   80 loại đồ thông dụng: thấy "laptop", "cup", "cell phone", không biết "ESP8266" hay "breadboard", và không trả lời được câu hỏi tự do.
   Đề xuất: cloud ở bản này, YOLO làm dự phòng khi mất mạng nếu sau này thấy cần.
3. **Ảnh rời nhà khi gọi.** Mỗi lần hỏi, một ảnh mặt bàn được gửi tới nhà cung cấp model (D8 đã chấp nhận). Đề xuất ghi rõ trong
   `docs/security.md` và không bao giờ chụp nếu không có lệnh.
