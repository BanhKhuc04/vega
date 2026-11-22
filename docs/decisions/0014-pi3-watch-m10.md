# Decision Brief 0014 — Pi 3 làm người gác và tai vệ tinh · M10 thông báo điện thoại

| | |
|---|---|
| **Ngày** | 2026-11-22 |
| **Trạng thái** | Bản nháp, chờ duyệt |
| **Dựa trên** | 0012 (M10, M12, M13, R5 ngân sách CPU, R7 riêng tư, rủi ro 7 ntfy trên iOS), 0013 (B5–B6 giám sát, B12 `presence`), 0009 (`pc-agent` viết để chạy được trên Linux) |
| **Sửa** | 0012: R2 (làm M10 trước M9), M10 (ntfy chạy trên Pi 3), M12 và M13 (phần nghe 24/7 chạy trên Pi 3) |
| **Nhánh** | `feat/m10-watch`, từ `main` |

## 1. Vấn đề

- **Pi 4 tự giám sát chính nó.** `health.sh` và `HealthWatch` (0013) báo được container chết, đĩa đầy, quá nhiệt. Nhưng Pi 4 mất điện,
  treo, hỏng thẻ nhớ hay rớt mạng thì không còn gì chạy để báo. Chủ chỉ biết khi mở VEGA và thấy trắng màn.
- **Alert chỉ hiện trên màn ở bàn.** Đang ở ngoài thì build hỏng hay Pi quá nhiệt cũng không biết. Đây là M10 của 0012.
- **M12 và M13 đặt việc nghe 24/7 lên Pi 4**, đúng lúc `vega-vision` giữ 2 lõi khi có người xem camera. R5 phải bắt giọng nói và camera
  nhường nhau.
- Chủ dự án **có sẵn một Pi 3 đang để không.**

## 2. Pi 3 làm được gì

Pi 3: 4 lõi Cortex-A53 1,2–1,4 GHz, **RAM 1 GB**, USB 2.0, Wi-Fi, Bluetooth. Khoảng một nửa tốc độ Pi 4, một phần tư RAM. Số liệu dưới
đây lấy từ nguồn công bố (cùng nguồn với 0012), **chưa đo trên Pi 3 của VEGA**.

| Việc | Số liệu | Kết luận |
|---|---|---|
| ntfy (máy chủ thông báo) | khoảng 30–50 MB RAM, có bản ARM64 | ✅ Nhẹ |
| Script gác (hỏi Pi 4 mỗi phút) | vài MB | ✅ Không đáng kể |
| Wake word (openWakeWord) | một lõi **Pi 3** chạy 15–20 model theo thời gian thực | ✅ Dư sức |
| Nhận giọng chủ | dưới 200 ms cho câu 5 giây trên **Pi 3B** | ✅ Chạy tốt |
| Phân loại âm thanh (CED-tiny) | 5,5M tham số, 6 MB int8 | ✅ Nhiều khả năng ổn, phải đo |
| STT tiếng Việt offline (Zipformer-vi) | chưa có số cho Pi 4, Pi 3 còn chậm hơn | ❌ Không đặt trên Pi 3. Để trên Pi 4 (nếu M12 đo đạt) hoặc Groq |
| Cả stack VEGA (dự phòng cho Pi 4) | riêng `vega-voice` đã giới hạn 512 MB | ❌ Không đủ RAM |
| LLM, YOLO trực tiếp, Piper medium | | ❌ Quá chậm |

**Tóm lại:** Pi 3 hợp với việc nhỏ chạy liên tục, cần sống độc lập với Pi 4: gác, thông báo, nghe. Cần **Pi OS Lite 64-bit**, vì
onnxruntime (cho wake word, nhận giọng, CED về sau) chỉ phát hành gói ARM 64-bit.

## 3. Quyết định

| # | Quyết định |
|---|---|
| P1 | **Vai trò của Pi 3, theo thứ tự:** (1) người gác Pi 4 và máy chủ ntfy cho M10, làm ngay trong brief này; (2) tai vệ tinh cho M12 và M13, làm theo brief riêng của từng mốc. Pi 3 **không chạy stack Docker của VEGA** và chỉ giữ mật khẩu riêng của nó (MQTT `watch`, ntfy). Pi 3 hỏng thì VEGA trên Pi 4 vẫn chạy đủ, chỉ mất thông báo điện thoại |
| P2 | **Cài bằng một lệnh:** Pi OS Lite 64-bit, Tailscale (tên máy `vega-watch`), rồi `infra/pi3/setup.sh`. Script cài ntfy từ kho apt chính thức của ntfy (không dùng Docker, để tiết kiệm RAM), `mosquitto-clients`, script gác và systemd timer. Chạy lại nhiều lần không hỏng gì, giống `infra/pi/setup.sh` |
| P3 | **Người gác (`vega-watch`) chạy mỗi phút:** đọc bản retained của `vega/system/health` trên Mosquitto của Pi 4 qua Tailscale, bằng user MQTT mới `watch`. Không nối được, hoặc báo cáo cũ hơn 3 phút, thì tính là một lần hỏng. Hỏng thì `tailscale ping` Pi 4 để ghi rõ nguyên nhân: "Pi 4 không trả lời (mất điện hoặc mạng)" hay "Pi 4 còn sống nhưng MQTT hoặc báo cáo sức khoẻ ngừng". **3 lần hỏng liên tiếp** (khoảng 3 phút) thì đẩy **một** thông báo khẩn. Hết lỗi thì đẩy một thông báo "Pi 4 đã trở lại". Không nhắc lại trong lúc lỗi kéo dài |
| P4 | **Pi 4 gác lại Pi 3:** mỗi phút `vega-watch` publish nhịp tim `vega/system/watch` (retained, `{v, ts}`). `HealthWatch` thêm một vấn đề: nhịp tim cũ hơn 5 phút thì hiện Alert "người gác Pi 3 mất" trên màn VEGA, giống cách đang báo `health.sh` im lặng. Chưa cài Pi 3 (chưa từng có nhịp tim) thì không báo |
| P5 | **User MQTT `watch`:** ACL chỉ đọc `vega/system/health` và chỉ ghi `vega/system/watch`. Không đọc được lệnh, thiết bị hay vị trí. `infra/pi/setup.sh` tạo user này như các user khác |
| P6 | **ntfy chạy trên Pi 3, không trên Pi 4.** Pi 4 chết thì ntfy trên Pi 4 cũng chết theo, và đó lại là lúc cần báo nhất. ntfy chỉ nghe trên Tailscale (HTTPS bằng `tailscale serve`, giống Pi 4), `auth-default-access: deny-all`. Có hai tài khoản: `vega` chỉ ghi (bộ não trên Pi 4 và `vega-watch` dùng) và `phone` chỉ đọc (app ntfy trên iPhone). Chỉ một topic, tên ngẫu nhiên do setup sinh |
| P7 | **iPhone:** app ntfy cho iOS, đăng ký `https://vega-watch.<tailnet>.ts.net`. Muốn iOS báo tức thì, máy chủ ntfy tự host phải đặt `upstream-base-url: https://ntfy.sh`. Khi đó ntfy.sh **chỉ nhận mã tin và mã băm của tên topic** để đánh thức iPhone qua Apple. Nội dung tin vẫn được iPhone tải thẳng từ Pi 3 qua Tailscale. Ghi rõ điều này trong `docs/security.md`. Xem câu hỏi mở 3 |
| P8 | **Bộ não gửi gì (M10):** (a) **khẩn**, luôn gửi: mọi vấn đề của `HealthWatch`, mất người gác Pi 3, và về sau báo khói, kính vỡ (M13); (b) **thường**: CI hỏng, lời nhắc tới giờ; (c) **thấp**: Briefing 7:00 tóm một dòng. **Chủ đang ở nhà (`presence: home`, M8) thì chỉ gửi loại khẩn**, vì màn ở bàn đã hiện. Không biết chủ ở đâu thì gửi như đang vắng nhà. Mỗi vấn đề chỉ gửi một lần, dùng lại cơ chế "một Alert cho mỗi vấn đề mới" của `HealthWatch`. Tin không chứa toạ độ, nội dung mail hay key |
| P9 | **Gửi bằng HTTP của ntfy** (`POST` có token, `Priority`, `Title`, `Tags`), không thêm thư viện. ntfy không trả lời thì bộ não ghi log, `/status` và Console ghi "thông báo điện thoại: lỗi", không thử lại liên tục và không làm hỏng lệnh đang chạy. Không cấu hình `NTFY_URL` thì tắt hẳn (giả lập và CI) |
| P10 | **Tai vệ tinh (M12, M13, brief riêng sau):** `pc-agent` chạy nguyên trên Pi 3 với mic USB và loa, gửi âm thanh tới `/voice/stt` của Pi 4, đọc trả lời bằng Piper của Pi 4. Nhận giọng chủ và CED-tiny chạy trên Pi 3. STT offline (nếu M12 đo đạt) chạy trên Pi 4. Hệ quả cho R5: **Pi 4 không còn chạy nghe 24/7**, chỉ chạy STT theo đợt, nên camera không phải nhường lõi cho wake word nữa |

## 4. Scope (chỉ phần người gác và M10)

- **W1 Pi 3:** `infra/pi3/setup.sh` (ntfy, cấu hình ntfy, tài khoản và topic, `tailscale serve`, `vega-watch` và timer), `--dry-run` cho CI.
- **W2 `vega-watch`:** script bash theo P3 và P4, giữ trạng thái "đang báo lỗi" trong một file nhỏ để không báo lặp. Test trong CI bằng
  `mosquitto_sub`, `curl`, `tailscale` giả.
- **W3 Pi 4:** user MQTT `watch` và ACL (P5), biến `NTFY_URL`, `NTFY_TOKEN`, `NTFY_TOPIC` trong `brain.env`.
- **W4 Bộ não:** gửi ntfy theo P8 và P9, `HealthWatch` đọc `vega/system/watch` (P4), dòng mới trong `/status` và thẻ Hôm nay của Console.
  Contract thêm topic `vega/system/watch` (CONTRACT_VERSION 9).
- **W5 Giả lập:** `npm run vega` có nhịp tim người gác giả. ntfy giả chỉ ghi log những gì lẽ ra sẽ gửi.
- **W6 Tài liệu:** `docs/pi-setup.md` mục "Pi 3: người gác và thông báo", cài app ntfy trên iPhone; `docs/security.md` (user `watch`, ntfy,
  ntfy.sh chuyển tiếp); README.

**Ngoài phạm vi:**
- Tai vệ tinh (P10): brief của M12, M13.
- Telegram: chỉ làm nếu ntfy trên iPhone không dùng được (câu hỏi mở 3).
- Bản backup thứ ba trên Pi 3: Pi 4 và Google Drive là đủ.
- Pi 3 chạy dự phòng thay Pi 4.
- Zigbee trên Pi 3: brief của M2 quyết định.
- Nhiều điện thoại, nhiều người nhận.

## 5. Definition of Done

- [ ] Bộ não: Alert khẩn gửi ntfy với `Priority: 5`. Chủ ở nhà thì CI hỏng không gửi, Pi quá nhiệt vẫn gửi. Một vấn đề kéo dài chỉ gửi một
      lần. ntfy không trả lời thì lệnh vẫn chạy và `/status` ghi lỗi. Có test cho tất cả.
- [ ] Bộ não: nhịp tim người gác cũ hơn 5 phút thì Alert một lần, có lại thì hết. Chưa từng có nhịp tim thì không báo. Có test.
- [ ] `vega-watch` (CI, lệnh giả): báo cáo cũ 3 lần liên tiếp thì gửi đúng một tin khẩn, ghi đúng nguyên nhân theo kết quả
      `tailscale ping`. Có lại thì gửi đúng một tin "đã trở lại". Hỏng 1–2 lần rồi có lại thì không gửi gì.
- [ ] Contract có test cho `vega/system/watch`. Contract cũ vẫn hợp lệ.
- [ ] Không tin nào chứa toạ độ, token hay nội dung mail (test kiểm chuỗi gửi đi).
- [ ] *(Chủ dự án)* Cài Pi 3 theo `docs/pi-setup.md` trong dưới 30 phút.
- [ ] *(Chủ dự án)* Rút điện Pi 4: iPhone báo trong 5 phút. Cắm lại: iPhone báo "đã trở lại".
- [ ] *(Chủ dự án)* Đang ở ngoài, push code lỗi: iPhone báo trong 2 phút (tiêu chí M10 của 0012).
- [ ] *(Chủ dự án)* Tắt Pi 3: màn VEGA hiện Alert trong 6 phút.

## 6. Câu hỏi mở

1. **Đổi thứ tự: làm M10 (kèm người gác) trước M9?** Đề xuất: có. Đây là lỗ thật (không ai báo khi Pi 4 chết), làm vài ngày, và Pi 3 đang
   có sẵn. M9 làm ngay sau.
2. **Pi 3 là 3B hay 3B+** (chữ in trên bo mạch)? Không đổi thiết kế, chỉ để ghi số đo. 3B+ có Ethernet nhanh hơn và Wi-Fi 5 GHz.
3. **ntfy trên iPhone cần chuyển tiếp qua ntfy.sh để báo tức thì** (P7). Chấp nhận, hay dùng Telegram làm kênh chính? Telegram thì
   Telegram thấy toàn bộ nội dung tin. Đề xuất: ntfy, vì ntfy.sh chỉ thấy mã tin.
4. **Pi 3 cắm dây mạng hay Wi-Fi, và có cắm chung ổ điện với Pi 4?** Đề xuất: dây mạng, khác ổ điện nếu được (xem rủi ro 1).

## 7. Rủi ro

1. **Mất điện hay mất internet cả nhà** thì Pi 3 cũng tắt hoặc không gửi được, nên không có báo. Muốn bắt cả trường hợp này phải có một
   máy ngoài nhà, ví dụ dịch vụ kiểu healthchecks.io nhận tín hiệu từ Pi 4 mỗi phút và tự báo khi tín hiệu ngừng. Đề xuất: để sau, cần
   thì làm brief riêng. Một UPS nhỏ cho Pi 4, Pi 3 và router cũng giải quyết phần mất điện ngắn.
2. **ntfy trên iOS:** 0012 ghi có báo cáo mất âm thanh từ iOS 26.2. DoD có bước thử thật trên iPhone. Hỏng thì chuyển sang Telegram.
3. **Báo nhầm khi Pi 4 khởi động lại** (cập nhật, `setup.sh`): mất khoảng 1–2 phút, dưới ngưỡng 3 phút nên không báo. Build lại lâu hơn thì
   có thể báo một lần, chấp nhận được.
4. **Thẻ nhớ của Pi 3 mòn:** Pi 3 hầu như không ghi gì ngoài log. Cấu hình journald giữ log trong RAM.
5. **Thêm một máy phải cập nhật:** `infra/pi3/setup.sh` chạy lại được nhiều lần, và hai máy dùng chung một repo.
