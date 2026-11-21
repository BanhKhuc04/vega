# Decision Brief 0013 — M8 · Backup, giám sát, Console, Locate, PWA

| | |
|---|---|
| **Ngày** | 2026-11-21 |
| **Trạng thái** | Đã duyệt (2026-11-21) |
| **Dựa trên** | 0002 (M8, D9 phần cứng rút được, mục 7 ma trận sự cố, mục 8 bảo mật), 0012 (R2: làm M8 trước M9; thông báo điện thoại tách ra M10), 0011 (Pi 4) |
| **Nhánh** | `feat/m8-ops`, từ `main` (sau PR #13) |

## 1. Vấn đề

VEGA đã chạy thật trên Pi 4 (`vega.<tailnet>.ts.net`), nhưng:

- **Chưa có backup.** Volume `brain-data` chứa `brain.db` (lời nhắc, nhật ký lệnh, sổ chi phí), và `infra/pi` có `.env`, `brain.env`
  (key AI, refresh token Google), `mosquitto/passwd`. Thẻ nhớ hỏng là mất hết, phải tạo lại key và đăng nhập Google lại.
- **Không ai báo khi một dịch vụ chết.** Docker tự khởi động lại container, nhưng một container bị khởi động lại liên tục, đĩa đầy hay
  Pi quá nhiệt thì không hiện ở đâu cả.
- **Muốn xem hay sửa dữ liệu thì phải gõ lệnh.** Không có chỗ để xem lời nhắc, nhật ký lệnh, chi phí theo ngày, thiết bị nào offline.
- Màn **Locate** của template vẫn chạy dữ liệu giả. Trên điện thoại, VEGA chỉ là một tab trình duyệt.

Tiêu chí của 0002 cho M8 vẫn giữ nguyên: **xoá thẻ nhớ, dựng lại toàn bộ từ repo và backup trong dưới 1 giờ.**

## 2. Mục tiêu

**Xong khi:**
- Có backup tự động mỗi đêm, đã mã hoá, và đã thử dựng lại thật trên Pi từ thẻ nhớ trắng trong dưới 1 giờ.
- Một dịch vụ chết, đĩa gần đầy, Pi quá nhiệt hay backup quá 36 giờ chưa chạy thì màn VEGA hiện Alert.
- Có trang **Console** để xem và sửa dữ liệu của VEGA.
- Điện thoại gửi vị trí, hỏi "tôi đang ở đâu" thì màn Locate hiện bản đồ thật.
- VEGA cài được lên màn hình chính của điện thoại.

## 3. Quyết định

| # | Quyết định |
|---|---|
| B1 | **Backup chạy trên Pi mỗi đêm lúc 03:30** bằng `infra/pi/backup.sh` và một systemd timer (setup.sh cài). Sao lưu: (1) `brain.db` bằng `VACUUM INTO` qua `docker compose exec vega-brain` (bản chụp nhất quán khi bộ não đang ghi, `node:sqlite` hỗ trợ sẵn), (2) `infra/pi/.env`, `brain.env`, `mosquitto/passwd`, (3) `google-token.json` nếu có. Không sao lưu image hay model, vì dựng lại được từ repo |
| B2 | **Mã hoá bằng `age`** (một file nhị phân, có sẵn trong Debian), khoá công khai nằm trên Pi, **khoá bí mật chỉ nằm trên PC và trong trình quản lý mật khẩu của chủ**. Một bản backup bị lộ thì không đọc được |
| B3 | **Nơi lưu:** giữ 14 bản trên ổ của Pi (`BACKUP_DIR`, mặc định `/var/backups/vega`, nên là SSD), và **một bản ra khỏi Pi**. Mặc định đề xuất: `rclone copy` lên Google Drive của chủ (đã có tài khoản Google, gói miễn phí đủ cho vài MB mỗi ngày). Không cấu hình rclone thì chỉ giữ trên Pi và màn hình ghi rõ "backup chỉ có trên Pi". Xem câu hỏi mở 1 |
| B4 | **Dựng lại bằng một lệnh:** `./setup.sh --restore <file.age>` giải mã (hỏi khoá bí mật), đặt lại `.env`, `brain.env`, `passwd`, nạp `brain.db` vào volume rồi `docker compose up -d`. `docs/pi-setup.md` thêm mục "Dựng lại từ đầu", ghi thời gian từng bước |
| B5 | **Bộ não theo dõi sức khoẻ** (đã đọc được nhiệt độ, CPU, RAM ở `pistats.ts`): thêm % đĩa trống, tuổi của bản backup mới nhất (backup.sh ghi một file trạng thái nhỏ vào volume), và trạng thái container. **Thêm healthcheck cho `vega-ui`, `vega-voice`, `vega-vision`, `vega-brain`.** Một script `health.sh` chạy mỗi phút bằng systemd, đọc `docker compose ps --format json` và publish `vega/system/health` (retained) bằng user MQTT riêng `health`, chỉ ghi được topic đó. Bộ não **không** được mount docker socket (tương đương quyền root trên máy) |
| B6 | **Ngưỡng Alert:** container unhealthy hoặc khởi động lại ≥ 3 lần trong 10 phút; đĩa còn < 10%; Pi ≥ 80 °C trong 2 phút; backup quá 36 giờ; mất vị trí điện thoại không phải Alert. Mỗi loại báo một lần cho tới khi hết, `/status` liệt kê tất cả. Đẩy về điện thoại là việc của M10 |
| B7 | **Console là một trang riêng `/console`** trong `dashboard/` (Vite thêm một trang, HTML + TS thường, không framework mới, không FUI). Phục vụ bởi `vega-ui`, cùng mức truy cập với màn VEGA (localhost và Tailscale). Dữ liệu lấy qua **API JSON của bộ não** trên server HTTP đang có (`voice.ts`, nginx đã chuyển `/voice/*` vào), thêm tiền tố `/api/*` |
| B8 | **Console có 6 thẻ:** Hôm nay (sức khoẻ, backup, chi phí), Thiết bị (trạng thái, lần cuối thấy), Lời nhắc (xem, **huỷ**), Nhật ký lệnh (500 lệnh gần nhất, lọc theo nguồn: chữ, giọng, luật), Chi phí (theo ngày, theo việc: router, chat, research, vision, STT), Quyền (quyền Google và GitHub đang cấp, camera và mic dùng lần cuối). **Chỉ hai hành động ghi:** huỷ lời nhắc và bật/tắt thiết bị. Cả hai đi qua `vega/system/command` như mọi lệnh khác, không có đường tắt |
| B9 | **API cần khoá:** mọi `/api/*` đòi header `Authorization: Bearer <CONSOLE_TOKEN>` (setup.sh sinh ngẫu nhiên, vega-ui chèn vào trang như đang làm với mật khẩu MQTT của `ui`). Kiểm độ dài và kiểu mọi tham số. API chỉ đọc SQLite và publish lệnh, không chạy shell |
| B10 | **Locate bằng OwnTracks** (app miễn phí, Android và iOS) ở chế độ MQTT, kết nối tới Mosquitto **qua Tailscale** (điện thoại cài Tailscale). User MQTT mới `phone`, ACL **chỉ ghi** `owntracks/<user>/<thiết bị>` và đọc `owntracks/<user>/+/cmd`. Bộ não đọc vị trí, chỉ giữ **vị trí mới nhất** trong RAM và trong SQLite (không lưu lịch sử) |
| B11 | **Màn Locate dùng dữ liệu thật:** "tôi đang ở đâu", "điện thoại ở đâu", "where am I" → cảnh `locate` với toạ độ, độ chính xác, lần cập nhật cuối, khoảng cách tới nhà (`HOME_LAT/HOME_LON` hoặc `WEATHER_LAT/LON`) và vùng (OwnTracks *regions*: "Nhà", "Công ty"). Bản đồ: ô OpenStreetMap tải từ trình duyệt, ghi nguồn đúng quy định. Không có mạng hay tải ô lỗi thì quay về bản vẽ `mapSVG` của template. Nút **Chỉ đường** mở Google Maps trong tab mới, VEGA không tự tính đường đi |
| B12 | **Vào hay ra khỏi vùng "Nhà"** sinh sự kiện `vega/system/presence` (`home` / `away`, retained). M8 chỉ hiện trên màn Idle và Console. Luật dùng sự kiện này để ở M2 và M16 |
| B13 | **PWA:** `manifest.webmanifest` (tên VEGA, icon quả cầu, `display: standalone`, nền tối) và một service worker chỉ cache vỏ trang tĩnh (HTML, JS, CSS, font). Không cache dữ liệu hay `/api`. Offline thì mở được vỏ trang và hiện chip OFFLINE như ma trận sự cố của 0002 |
| B14 | **Giả lập (D11):** `npm run vega` có OwnTracks giả (một điểm di chuyển quanh nhà, vào và ra vùng "Nhà"), `vega/system/health` giả, và Console chạy với dữ liệu mẫu. `backup.sh` có chế độ `--dry-run` để CI chạy |

## 4. Scope

- **W1 Backup và dựng lại:** `backup.sh`, `setup.sh --restore`, systemd timer, `age`, `rclone` tuỳ chọn, test vòng tròn trong CI (backup một
  `brain.db` mẫu → giải mã → so khớp).
- **W2 Sức khoẻ:** `health.sh`, healthcheck cho mọi container, bộ não đọc `vega/system/health`, đĩa, tuổi backup, Alert theo B6, `/status`.
- **W3 API của bộ não:** `/api/*` có token, test.
- **W4 Console:** 6 thẻ, hai hành động ghi, e2e.
- **W5 Locate:** user `phone` và ACL, bộ não đọc OwnTracks, lệnh cục bộ, cảnh `locate` thật, `presence`, contract mới (thêm topic,
  `locate` thêm trường nếu cần), e2e với OwnTracks giả.
- **W6 PWA:** manifest, icon, service worker, kiểm Lighthouse "installable".
- **W7 Tài liệu:** README, `docs/pi-setup.md` (dựng lại từ đầu, cài OwnTracks), `docs/security.md` (backup, token Console, user `phone`,
  dữ liệu vị trí).

**Ngoài phạm vi (theo 0012):**
- Đẩy thông báo về điện thoại (M10), Telegram.
- OTA cho ESP: chuyển sang M2, vì chưa có firmware nào.
- Lịch sử vị trí, chia sẻ vị trí với người khác.
- Console cho nhiều người, đăng nhập bằng mật khẩu.
- Sửa luật trong Console (luật có từ M2).
- Sao lưu image Docker hay model.

## 5. Definition of Done

- [ ] CI: `backup.sh --dry-run` tạo file `.age`, giải mã bằng khoá thử, `brain.db` khôi phục có đúng số dòng của bản gốc; file bí mật không
      bao giờ được ghi ra đĩa ở dạng chưa mã hoá ngoài thư mục tạm có quyền `700`, và thư mục đó được xoá.
- [ ] Bộ não: health giả báo một container unhealthy → Alert một lần, hết lỗi → về bình thường; đĩa < 10%, Pi ≥ 80 °C, backup quá
      36 giờ đều có test.
- [ ] API: thiếu token hoặc sai token → 401; tham số sai kiểu → 400; huỷ lời nhắc đi qua `vega/system/command`; test.
- [ ] e2e Console (dữ liệu mẫu): 6 thẻ hiện dữ liệu, huỷ một lời nhắc thì nó biến mất, màn 390 px không cuộn ngang.
- [ ] e2e Locate (OwnTracks giả): "tôi đang ở đâu" → cảnh `locate` có toạ độ và vùng; ra khỏi vùng "Nhà" → `presence: away`.
- [ ] Contract có test cho topic mới; cảnh `locate` cũ vẫn hợp lệ.
- [ ] PWA: Lighthouse báo cài được; tắt mạng thì vỏ trang vẫn mở và hiện OFFLINE.
- [ ] *(Chủ dự án)* Trên Pi: chạy `backup.sh`, thấy file trên Pi và (nếu cấu hình) trên Google Drive.
- [ ] *(Chủ dự án)* **Dựng lại thật:** thẻ nhớ trắng (hoặc thẻ khác) → cài theo `docs/pi-setup.md` → `setup.sh --restore` → lời nhắc,
      nhật ký và key AI còn nguyên, Google không cần đăng nhập lại. Tổng thời gian dưới 1 giờ, ghi vào `docs/pi-setup.md`.
- [ ] *(Chủ dự án)* Điện thoại cài OwnTracks và Tailscale, ra khỏi nhà thì Idle chuyển "away", hỏi "tôi đang ở đâu" thì bản đồ đúng.
- [ ] *(Chủ dự án)* Cài VEGA lên màn hình chính điện thoại từ trình duyệt.

## 6. Câu hỏi mở

1. **Bản backup ra khỏi Pi để ở đâu?** Đề xuất Google Drive qua `rclone` (miễn phí, đã có tài khoản). Khác: ổ cứng của PC (chỉ khi PC
   bật, có thể lỡ nhiều đêm), NAS (`nasvanhkhuc` trong tailnet đang offline), hoặc chỉ giữ trên Pi.
2. **Điện thoại là Android hay iPhone?** OwnTracks trên iOS gửi vị trí ít hơn khi app chạy nền (dựa vào thay đổi vị trí đáng kể của
   iOS), nên vào/ra vùng có thể trễ vài phút.
3. **Pi đã chạy trên SSD chưa?** Nếu vẫn là thẻ nhớ, nên mua SSD trước khi làm W1. Thẻ nhớ ghi SQLite mỗi ngày là thứ hỏng nhanh nhất.
4. **Có cần thẻ Console thứ 7 cho trí nhớ (M9)?** Đề xuất: M9 tự thêm thẻ của mình, M8 không làm trước.

## 7. Rủi ro

- **Khoá bí mật `age` mất thì backup vô dụng.** setup.sh in khoá ra một lần và yêu cầu chủ lưu vào trình quản lý mật khẩu, kèm một lần
  thử giải mã ngay sau khi cài.
- **Token Console nằm trong trang**, giống mật khẩu MQTT `ui`. Ai vào được tailnet và mở trang là đọc được. Chấp nhận được với một người
  dùng; nếu sau này mở cho người khác thì phải có đăng nhập thật.
- **Vị trí là dữ liệu nhạy cảm.** Chỉ giữ điểm mới nhất, không gửi cho model AI trừ khi chủ hỏi một câu cần vị trí, và log không ghi toạ
  độ.
- **Ô bản đồ OpenStreetMap** có chính sách sử dụng: một người dùng thì ổn, phải ghi nguồn và không tải trước hàng loạt.
