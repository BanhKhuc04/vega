# Decision Brief 0016: chia VEGAS thành hai phần, Pi 4 (bộ não) và Pi 3 (hạ tầng)

| | |
|---|---|
| **Ngày** | 2026-11-23 |
| **Trạng thái** | Bản nháp, chờ duyệt. Chủ dự án đồng ý chia hai phần; thứ tự các mốc Pi 3 còn chờ chọn (mục 7) |
| **Dựa trên** | 0012 (R3 Zigbee, R5 ngân sách CPU, M12, M13, M16), 0014 (P1 vai trò Pi 3, P2 cài không Docker, P6 ntfy trên Pi 3, P10 tai vệ tinh) |
| **Sửa** | 0012 R3 (Zigbee2MQTT chạy trên Pi 3, không chạy trong container trên Pi 4); 0012 M16 (dò điện thoại bằng Bluetooth của Pi 3); 0014 P1 (Pi 3 nhận thêm vai trò trạm điều hành và cổng thiết bị) |
| **Bị sửa bởi** | 0017 (đã duyệt 2026-11-27): P3.1, Uptime Kuma đọc trạng thái service qua MQTT và không báo trùng với người gác M10 |

## 1. Vấn đề

- Pi 4 đã chạy đủ phần bộ não: MQTT, `vega-brain`, giọng nói, camera, dashboard. Chủ dự án muốn **tạm để yên Pi 4** và phát triển tiếp
  trên Pi 3.
- Pi 3 hiện chỉ làm người gác và chạy ntfy (0014). Đo ngày 2026-11-23: RAM trống khoảng **715/905 MB**, thẻ nhớ còn trống **24/29 GB**,
  load 0.00. Pi 3 chưa có Docker và **đã báo thiếu điện** (`throttled=0x50000`); có lần dùng chung nguồn với Pi 4 làm sập cả hai.
- Lộ trình hiện tại (0012) viết theo mốc M, không ghi rõ mốc nào thuộc máy nào, nên khó thấy Pi 3 sẽ làm gì tiếp.

## 2. Nguyên tắc chia việc

**Pi 4 là bộ não**, nơi suy nghĩ và ra quyết định: hiểu lệnh, nhớ, gọi AI, STT và TTS, camera, luật tự động.

**Pi 3 là hạ tầng.** Giá trị lớn nhất của nó là **độc lập với Pi 4**, nên chỉ giao cho Pi 3 hai loại việc:

1. Việc **phải còn chạy khi Pi 4 sập**: gác, thông báo, xem tình trạng hệ thống, cổng vào mạng nhà, sổ log.
2. Việc **nhẹ, gần thiết bị**: sóng radio (Zigbee, Bluetooth), mic. Pi 3 chỉ dịch tín hiệu sang MQTT, còn quyết định vẫn do Pi 4.

Pi 3 chỉ có 1 GB RAM và chạy trên thẻ nhớ, nên **không** nhận việc nặng, cũng không nhận việc ghi đĩa liên tục.

## 3. Quyết định

| # | Quyết định |
|---|---|
| T1 | **Hai phần, hai danh sách mốc.** Mốc của Pi 4 giữ tên M (0012). Mốc của Pi 3 đặt tên **P3.x** (mục 4). Mỗi mốc vẫn có brief riêng (R8 của 0012) |
| T2 | **Pi 4 tạm dừng phát triển mới.** Trên Pi 4 chỉ triển khai bản sửa lỗi và những phần Pi 3 cần (ví dụ bộ não dịch `zigbee2mqtt/*` sang `vega/*` khi làm P3.3). Danh sách mốc còn lại của Pi 4 ở mục 5 |
| T3 | **Pi 3 vẫn không chạy stack VEGA** (giữ P1 của 0014). Pi 3 hỏng thì bộ não trên Pi 4 vẫn chạy đủ. Riêng **AdGuard Home** (P3.2) làm cả nhà mất DNS khi Pi 3 sập, nên chỉ bật khi router đã có DNS dự phòng |
| T4 | **Ngân sách RAM của Pi 3:** mọi thứ chạy liên tục tổng cộng không quá **600 MB**, chừa khoảng 300 MB cho hệ điều hành. Mỗi mốc P3 phải ghi RAM đo được trên máy thật trong brief của mình |
| T5 | **Giữ thẻ nhớ:** log và dữ liệu trên Pi 3 phải có xoay vòng và trần dung lượng. Việc nào ghi nhiều (backup, ghi âm) thì không đặt trên thẻ nhớ |
| T6 | **Nền trước, việc sau:** chưa có nguồn riêng cho Pi 3 thì không làm P3.2 trở đi |
| T7 | **Cách cài** (gói apt, binary hay Docker) chốt ở brief của từng mốc. Mặc định không dùng Docker để tiết kiệm RAM (P2 của 0014). Chỉ dùng Docker khi không có cách cài nhẹ hơn |

## 4. Phần Pi 3: hạ tầng

| Mốc | Nội dung | Vì sao | RAM ước tính | Cần mua | Xong khi |
|---|---|---|---|---|---|
| **P3.0 · Nền** | Nguồn riêng 5V/2.5A, cắm dây mạng thay Wi-Fi, giới hạn dung lượng log của hệ thống | Pi 3 đã báo thiếu điện hai lần. Mọi vai trò bên dưới đều cần nó sống ổn định | 0 | Nguồn 5V/2.5A, dây mạng | `vcgencmd get_throttled` báo `0x0` sau một tuần. Pi 3 nhận địa chỉ trên dây mạng |
| **P3.1 · Trạm điều hành** | **Uptime Kuma**: trang xanh/đỏ cho Pi 4, từng service VEGAS, PC, router, internet; có lịch sử uptime; báo qua ntfy sẵn có. **Cổng Tailscale**: subnet router (ở ngoài vẫn vào được router, camera, mạch ESP) và exit node. **Sổ log**: rsyslog nhận log từ Pi 4 và router | Người gác hiện tại chỉ biết Pi 4 sống hay chết. Uptime Kuma cho biết *cái gì* hỏng. Pi 4 sập thì log của nó vẫn còn trên Pi 3 để biết vì sao. Tailscale có sẵn, chỉ cần bật thêm | ~150 MB (Uptime Kuma), ~10 MB (rsyslog), ~0 (Tailscale) | Không | Tắt `vega-voice` trên Pi 4 thì Uptime Kuma hiện đỏ đúng service đó và iPhone nhận tin. Từ 4G vào được trang router qua Tailscale. Rút điện Pi 4 xong vẫn đọc được log 5 phút cuối của nó trên Pi 3 |
| **P3.2 · DNS cả nhà** | **AdGuard Home**: chặn quảng cáo và tracker cho mọi thiết bị, xem thiết bị nào gọi đi đâu, tên nội bộ (ví dụ `vegas.home`) | Nhẹ, lợi ích thấy ngay cho cả nhà | ~60 MB | Không | Quảng cáo trên điện thoại và TV bị chặn. Tắt Pi 3 thì vẫn vào được mạng nhờ DNS dự phòng của router (T3) |
| **P3.3 · Cổng thiết bị** | **Zigbee2MQTT** + USB Zigbee: cảm biến và công tắc Zigbee mua sẵn (cửa, chuyển động, nhiệt độ, nút bấm) đẩy vào MQTT của Pi 4. **Có mặt hay vắng nhà**: Bluetooth sẵn trên Pi 3 dò iPhone | Đây là cách mở rộng nhà thông minh rẻ và ổn định nhất, đỡ phải tự hàn ESP. Pi 4 vẫn là não. Vị trí từ OwnTracks chỉ biết ở nhà hay không, không biết ở phòng nào | ~150 MB (Zigbee2MQTT), ~20 MB (BLE) | USB Zigbee coordinator, thiết bị Zigbee | Bấm nút Zigbee thì đèn bật qua bộ não. Mang iPhone ra khỏi nhà 10 phút thì `presence` chuyển sang `away` |
| **P3.4 · Tai vệ tinh** | `pc-agent` trên Pi 3 với mic USB: "Hey Vegas" 24/7, nhận giọng chủ, nghe sự kiện âm thanh (M12, M13; P10 của 0014). STT và TTS vẫn ở Pi 4 | PC tắt vẫn gọi được VEGAS. Pi 4 không phải nghe 24/7, camera không phải nhường lõi | ~200 MB | Mic USB có công tắc, loa | PC tắt, nói "Hey Vegas, bật đèn" thì đèn bật |

Tổng RAM nếu chạy đủ P3.1 đến P3.4 khoảng **590 MB**, sát trần T4. Nếu đo thực tế vượt trần thì bỏ bớt (rsyslog sang Pi 4, hoặc gộp
P3.2 với router) trước khi thêm P3.4.

## 5. Phần Pi 4: bộ não (tạm để yên)

| Mốc | Trạng thái | Ghi chú |
|---|---|---|
| M0, M1, M3 đến M10 | Đã xong | Giọng nói, camera, trí nhớ, backup, Console, người gác |
| "Hey Vegas" trên PC | Đang train model wake word | Chạy trên PC, không đụng tới Pi 4 |
| M2 · Thiết bị thật | Chờ P3.3 | Phần Pi 4 chỉ còn bộ não dịch `zigbee2mqtt/*` sang `vega/*` và sổ thiết bị |
| M11 · Hiểu lệnh bằng embedding | Tạm dừng | Sửa lỗi "đúng chữ, sai việc" (ví dụ "tập trung 25 phút") |
| M12 · STT offline | Tạm dừng | Phần nghe chuyển sang P3.4. Pi 4 chỉ còn STT |
| M14 · Hành động ghi | Tạm dừng | |
| M15 · AI cục bộ trên PC | Tạm dừng | |
| M16 · Tự động hoá chủ động | Tạm dừng, cần M2 | Dò điện thoại bằng Bluetooth chuyển sang P3.3 |

## 6. Không làm trên Pi 3

| Việc | Lý do |
|---|---|
| Grafana, Prometheus | Hơn 400 MB RAM, ghi thẻ nhớ liên tục (T4, T5). Uptime Kuma đủ cho nhu cầu hiện tại |
| Biên dịch firmware ESPHome | Pi 3 mất 20–30 phút cho một bản. Biên dịch trên PC |
| MQTT dự phòng cho Pi 4 | Bộ não ở Pi 4. Pi 4 sập thì broker dự phòng không làm được gì, chỉ thêm rối |
| Kho backup trên thẻ nhớ | Mòn thẻ (T5). Chỉ xem xét lại khi Pi 3 có USB hoặc SSD |
| Chạy thay Pi 4 khi Pi 4 hỏng | Không đủ RAM cho stack VEGA (0014) |

## 7. Rủi ro và việc chủ dự án cần làm

**Rủi ro:**

1. **Thiếu điện.** Chưa xong P3.0 thì mọi vai trò mới đều có thể làm Pi 3 sập theo, và mất luôn người gác Pi 4.
2. **DNS là điểm chết chung** (P3.2). Bắt buộc có DNS dự phòng trên router.
3. **Hết RAM** khi chạy đủ bốn mốc. Đo sau mỗi mốc (T4).
4. **Wi-Fi chập chờn** làm cổng Tailscale và DNS không ổn định. P3.0 chuyển sang dây mạng.
5. **Mòn thẻ nhớ** vì log (T5).

**Chủ dự án cần:**

1. Duyệt brief này.
2. Mua **nguồn 5V/2.5A riêng cho Pi 3** và chuẩn bị dây mạng (P3.0).
3. Chọn thứ tự: đề xuất **P3.0 → P3.1 → P3.2 → P3.3 → P3.4**. P3.1 không cần mua gì. P3.3 cần USB Zigbee, P3.4 cần mic.
4. Xem router có cho đặt DNS phụ không (trước P3.2).
