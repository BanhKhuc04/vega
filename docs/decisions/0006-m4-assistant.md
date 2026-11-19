# Decision Brief 0006 — M4 · Trợ lý cá nhân

| | |
|---|---|
| **Ngày** | 2026-11-19 |
| **Trạng thái** | Đã duyệt (2026-11-19) |
| **Dựa trên** | 0002 (phương án 1.0, mục M4, màn Briefing và Focus), 0004 (M1), 0005 (M3, đã merge) |
| **Nhánh** | `feat/m4-assistant`, từ `main` |

## 1. Mục tiêu

VEGA biết lịch và hộp thư của chủ dự án, nhắc việc theo câu nói thường, và giữ yên lặng khi đang tập trung. Mỗi sáng
VEGA tự hiện một màn tóm tắt ngày hôm nay và đọc to.

**Xong khi:** đúng 7 giờ sáng (giờ đặt trong `BRIEFING_AT`), màn hình tự chuyển sang Briefing, hiện lịch hôm nay, mail
chưa đọc, thời tiết, phòng và CI, rồi đọc một câu tóm tắt. Nói "nhắc tôi 3 giờ chiều gọi mẹ" thì đúng 15:00 VEGA nhắc,
kể cả khi bộ não đã khởi động lại giữa chừng. Nói "tập trung 25 phút" thì trong 25 phút đó không có cảnh nào chen vào.

## 2. Quyết định

| # | Quyết định |
|---|---|
| G1 | **Đăng nhập Google bằng OAuth "Desktop app" của chính chủ dự án**, có PKCE, chuyển hướng về `127.0.0.1` (cổng ngẫu nhiên). Đăng nhập một lần bằng `npm run google-login` trên PC: lệnh mở trình duyệt, nhận mã, rồi ghi refresh token vào `google-token.json` (quyền file `600`, nằm trong `.gitignore`). Trên Pi thì chép file này sang (`scp`), vì Pi không có trình duyệt. Không có file thì tính năng Google tắt, VEGA vẫn chạy bình thường |
| G2 | **Quyền chỉ đọc, ít nhất có thể**: `calendar.readonly` và `gmail.readonly`. VEGA không tạo lịch, không gửi mail, không đánh dấu đã đọc. Mail chỉ lấy phần đầu thư (`From`, `Subject`, `format=metadata`), **không tải nội dung thư** |
| G3 | **Lịch**: hỏi Google Calendar mỗi 5 phút, lấy sự kiện từ giờ tới hết ngày mai trên lịch chính (`GOOGLE_CALENDARS`, mặc định `primary`). Sự kiện sắp tới đi vào `next_event` (đã có trong contract), nên dòng "next event" ở Idle chạy thật. Câu cục bộ: `hôm nay có lịch gì`, `lịch ngày mai`, `sự kiện tiếp theo`, `what's on today` |
| G4 | **Mail**: hỏi Gmail mỗi 10 phút, chỉ thư **chưa đọc trong Hộp thư chính** của 24 giờ qua (`is:unread in:inbox category:primary newer_than:1d`), tối đa 6 thư. Câu cục bộ: `có mail gì mới không`, `mail chưa đọc`, `any new mail` |
| G5 | **Thời tiết**: Open-Meteo (miễn phí, không cần khoá), toạ độ đặt trong `WEATHER_LAT` / `WEATHER_LON`, hỏi mỗi 30 phút. Không đặt toạ độ thì Briefing bỏ phần thời tiết. Câu cục bộ: `thời tiết thế nào`, `có mưa không`, `weather` |
| G6 | **Briefing**: bộ não **tự ghép, không gọi AI** (0 đồng, không bị prompt injection). Hiện mỗi ngày một lần lúc `BRIEFING_AT` (mặc định `07:00`, giờ theo `TZ`), hoặc khi gõ `briefing` / `tóm tắt hôm nay`. Nội dung đã có sẵn chỗ trong `briefingData`: lịch hôm nay, mail chưa đọc, phòng, CI; thời tiết nằm trong `summary`. Đọc to một câu, ví dụ "Chào buổi sáng. Hôm nay có 3 lịch, đầu tiên là 9 giờ họp nhóm. 2 mail chưa đọc. Trời 24 độ, chiều có mưa." Bộ não khởi động sau giờ briefing thì không bắn bù |
| G7 | **Nhắc việc**: lưu trong SQLite (bảng `reminders`), nên sống qua lần khởi động lại. Bộ định tuyến cục bộ hiểu các dạng thường gặp: `nhắc tôi sau 20 phút …`, `nhắc tôi lúc 15:30 …`, `nhắc tôi 3 giờ chiều …`, `… ngày mai`, `remind me in 10 minutes / at 5pm …`. Câu khó hơn thì đi qua LLM với tool `add_reminder(at, text)`; bộ não kiểm tra `at` nằm trong tương lai và không quá 1 năm. Tới giờ: màn Alert "Reminder" có nút **Snooze 10 min** và **Dismiss**, và đọc to. Lỡ giờ vì bộ não tắt: trễ dưới 1 giờ thì nhắc ngay, trễ hơn thì nhắc kèm chữ "missed". Xem và huỷ: `nhắc nhở của tôi`, `huỷ nhắc 2` |
| G8 | **Focus**: `tập trung 25 phút` (mặc định 25, tối đa 180). Bộ não giữ hẹn giờ; trong lúc tập trung, Alert của CI và lời nhắc **chỉ được xếp hàng**, không chiếm màn hình. Ô CI/CD vẫn cập nhật. Xác nhận thiết bị rủi ro cao vẫn hiện, vì do chính chủ dự án vừa ra lệnh. Hết giờ thì hiện Success "Focus done", đọc to, rồi hiện lần lượt các thông báo đã giữ. `dừng tập trung` / `stop focus` thì kết thúc sớm |
| G9 | **Lịch và mail là dữ liệu ngoài**: tiêu đề lịch (người khác mời được) và tiêu đề mail (ai cũng gửi được) có thể chứa câu như "tắt hết thiết bị". Các câu trả lời cục bộ và Briefing không đi qua AI. Nếu AI tự gọi `calendar_list` / `mail_list` thì kết quả được bọc `<external>` và lượt đó **không còn tool vật lý** (cơ chế đánh dấu nhiễm của M3) |
| G10 | **Câu trả lời của các tính năng M4 theo ngôn ngữ của câu hỏi.** Briefing tự hiện lúc 7 giờ không có câu hỏi, nên dùng `VEGA_LANG` (mặc định `vi`). Chữ trên giao diện (nhãn, nút) vẫn bằng tiếng Anh như template |

## 3. Scope

W1 đăng nhập Google (`npm run google-login`, PKCE, file token, tự làm mới access token, báo một lần khi token hết hạn) ·
W2 lịch: vòng hỏi 5 phút, `next_event`, tool `calendar_list`, câu cục bộ · W3 mail: vòng hỏi 10 phút, tool `mail_list`,
câu cục bộ · W4 thời tiết Open-Meteo · W5 Briefing: hẹn giờ hằng ngày, lệnh `briefing`, câu đọc to · W6 nhắc việc: bảng
SQLite, bộ phân tích giờ cục bộ, tool `add_reminder`, Alert có Snooze, xem và huỷ · W7 Focus: hẹn giờ, giữ thông báo, kết
thúc · W8 cấu hình, tài liệu (`README`, `docs/contract.md`, `docs/security.md` mục Google), e2e với Google và Open-Meteo giả.

**Thay đổi contract:** `alertData.snooze` (boolean, tuỳ chọn): thẻ hiện nút Snooze 10 min, gửi lệnh `snooze`. Không phá
tương thích.

**Ngoài phạm vi:** tạo hoặc sửa lịch, trả lời hoặc gửi mail, đọc nội dung thư, nhiều tài khoản Google, Briefing tự hiện
khi radar thấy bạn dậy (cần radar thật, để M2), cảnh đèn khi tập trung (cần thiết bị thật, để M2), trí nhớ hội thoại.

## 4. Definition of Done

- [ ] Google giả trong test: `npm run google-login` (với trình duyệt giả) ghi được file token quyền `600`; access token
  được làm mới khi hết hạn; refresh token bị thu hồi (`invalid_grant`) thì ghi một dòng cảnh báo và tắt tính năng Google,
  không lặp lỗi. Token và client secret không xuất hiện trong log, lỗi hay MQTT (có test).
- [ ] Lịch giả có sự kiện 9:00 thì dòng "next event" ở Idle hiện đúng; `hôm nay có lịch gì` trả lời cục bộ, 0 lượt gọi AI.
- [ ] Mail giả: `có mail gì mới không` trả lời người gửi và tiêu đề, 0 lượt gọi AI. Request tới Gmail chỉ dùng
  `format=metadata`.
- [ ] Đặt giờ giả 07:00 thì màn chuyển sang Briefing một lần, có lịch, mail, thời tiết, phòng, CI và câu đọc to. Không
  bắn lại trong cùng ngày.
- [ ] `nhắc tôi sau 1 phút uống nước` (đồng hồ giả) → đúng giờ hiện Alert "Reminder" và đọc to; Snooze dời 10 phút;
  khởi động lại bộ não giữa chừng vẫn nhắc. `nhắc tôi 3 giờ chiều …` và `remind me at 5pm …` ra đúng giờ.
- [ ] Đang Focus thì một build hỏng không chiếm màn hình; hết giờ thì hiện "Focus done" rồi mới tới Alert CI.
- [ ] Tiêu đề lịch hoặc mail chứa "tắt hết thiết bị" không làm thay đổi thiết bị nào, kể cả khi AI (mock) tự gọi tool lịch
  hoặc mail.
- [ ] lint, check, unit, e2e đều xanh. CI xanh.
- [ ] *(Chủ dự án)* Tạo OAuth client, chạy `npm run google-login`, thử thật: lịch, mail, một lời nhắc và Briefing.

## 5. Việc của chủ dự án

1. Trên Google Cloud Console: tạo project, bật **Google Calendar API** và **Gmail API**.
2. Màn đồng ý OAuth: loại **External**, thêm email của bạn vào test users.
3. Tạo OAuth client loại **Desktop app**, chép `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` vào `.env`.
4. Chạy `npm run google-login`, đăng nhập và đồng ý quyền chỉ đọc.
5. Đặt `WEATHER_LAT` / `WEATHER_LON` (toạ độ gần nhà, làm tròn 2 chữ số là đủ) nếu muốn có thời tiết.

Tôi sẽ hướng dẫn từng bước như lúc lấy token GitHub.

## 6. Câu hỏi mở

1. **Refresh token hết hạn sau 7 ngày khi app ở chế độ "Testing".** Đây là quy định của Google cho app chưa phát hành.
   Có hai cách: (a) mỗi tuần chạy lại `npm run google-login`; (b) chuyển app sang **"In production"** mà không xin xác
   minh: Google sẽ hiện cảnh báo "app chưa được xác minh" lúc đăng nhập (bấm "Advanced → tiếp tục"), nhưng token không
   còn hết hạn sau 7 ngày. Đề xuất (b), vì app chỉ có một người dùng là bạn. VEGA báo trên màn khi token hết hạn, nên
   cách (a) vẫn dùng được.
2. **`gmail.readonly` là quyền "restricted"** của Google: về nguyên tắc nó cho đọc cả nội dung thư, dù VEGA chỉ xin phần
   đầu thư. Quyền hẹp hơn (`gmail.metadata`) không cho dùng bộ lọc `category:primary`, nên chỉ lọc được "chưa đọc trong
   inbox", lẫn cả thư quảng cáo. Đề xuất giữ `gmail.readonly` và giới hạn trong code (`format=metadata`, có test).
3. **Giọng đọc Briefing bằng tiếng Việt** cần trình duyệt có giọng `vi`. Máy PC hiện chưa có (xem M5); khi đó Briefing
   vẫn hiện chữ, chỉ không đọc to.
