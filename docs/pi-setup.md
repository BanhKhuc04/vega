# Cài VEGAS lên Raspberry Pi 3

Mục tiêu: trên Pi, kiosk Chromium mở màn VEGAS ở mức `css`, dữ liệu đi qua Mosquitto có mật khẩu, `vega-brain` (M1) trả lời
lệnh từ thanh lệnh.
Script `infra/pi/setup.sh` và `infra/pi/docker-compose.yml` được viết và kiểm tra cú pháp (`bash -n`, `shellcheck`,
`docker compose config`) **ngoài Pi**; lần chạy thật đầu tiên là của chủ dự án.

## Chuẩn bị

- Raspberry Pi OS Lite **64-bit** (Bookworm), thẻ nhớ ≥ 16 GB (khuyến nghị SSD qua USB), Ethernet hoặc Wi-Fi, màn hình HDMI.
- SSH vào Pi, `git clone` repo này (hoặc `rsync`).
- Pi và PC cùng mạng LAN. **Không** forward cổng 1883, 9001, 8080 ra internet (chưa có TLS).
- **Tailscale** trên Pi và PC (khuyến nghị): từ M1, dashboard (8080) và WebSocket MQTT (9001) chỉ nghe ở `localhost` và địa chỉ
  Tailscale của Pi, không nghe ở LAN (`docs/security.md`). Cài Tailscale trước khi chạy `setup.sh` để script tự điền `TAILSCALE_IP`.

## Cài

```bash
cd vega
./infra/pi/setup.sh --dry-run        # xem trước sẽ làm gì, không đổi gì
sudo ./infra/pi/setup.sh             # cài Docker, zram, tạo mật khẩu, bật stack, cài kiosk
sudo reboot                          # kiosk lên sau khi khởi động lại
```

`setup.sh` chạy lại được nhiều lần (idempotent): chỉ làm bước còn thiếu, giữ nguyên `.env` đã có.

Các bước và nơi chỉnh:

| Bước | Chi tiết |
|---|---|
| Docker | cài bằng script chính thức nếu chưa có; bật `docker.service` |
| zram | `zram-tools`, zstd, 50% RAM (`/etc/default/zramswap`) |
| Bí mật | tạo `infra/pi/.env` (quyền 600, **không commit**) với mật khẩu ngẫu nhiên cho 3 user MQTT |
| Tailscale | điền `TAILSCALE_IP` trong `.env` bằng `tailscale ip -4` (trống = dashboard chỉ mở được trên chính Pi) |
| Bộ não | tạo `infra/pi/brain.env` (quyền 600, **không commit**) từ `brain.env.example`: nhà cung cấp AI, trần chi phí ngày. Để `LLM_ROUTER=none` thì chỉ chạy lệnh cục bộ |
| Mosquitto | `mosquitto/passwd` dựng lại từ `.env`; ACL ở `mosquitto/acl` |
| Stack | `infra/pi/docker-compose.yml`: `mosquitto` (64 MB), `vega-brain` (160 MB, SQLite ở volume `brain-data`), `vega-ui` nginx (48 MB), `vega-voice` Piper (512 MB, giọng nói có sẵn trong image ~130 MB), `restart: unless-stopped` |
| HTTPS | `tailscale serve --bg http://127.0.0.1:8080`: trang có `https://<tên-máy>.<tailnet>.ts.net`, để trình duyệt cho dùng mic (M5). Cần bật **MagicDNS** và **HTTPS Certificates** trong trang quản trị Tailscale trước; thiếu thì script báo và đi tiếp |
| Kiosk | `cage` + Chromium, unit `vega-kiosk.service`, mở `http://localhost:8080/?quality=css` |

Biến môi trường tùy chọn của script: `KIOSK_URL`, `KIOSK_USER` (mặc định user đang chạy `sudo`, hoặc `pi`).
`--no-kiosk` bỏ qua phần kiosk.

## MQTT: người dùng và quyền

| User | Quyền | Dùng cho |
|---|---|---|
| `brain` | đọc/ghi `vega/#` | bộ não (M1), công cụ `npm run sim` / `npm run scene` |
| `ui` | đọc `vega/#`, ghi `vega/system/command` | dashboard. Mật khẩu này nằm trong `/config.js` nên ai mở được dashboard đều thấy: vì vậy nó không ghi được gì khác, và dashboard chỉ mở được qua `localhost`/Tailscale |
| `device` | ghi `state`, `meta`, `availability`; đọc `set` | ESP. Từng thiết bị riêng có ở M2 |
| `health` | chỉ ghi `vega/system/health`, `vega/system/backup` | `health.sh`, `backup.sh` (M8) |
| `phone` | ghi `owntracks/vega/+`, đọc `owntracks/vega/+/cmd` | app OwnTracks trên điện thoại (M8) |
| `watch` | đọc `vega/system/health`, ghi `vega/system/watch` | người gác trên Pi 3 (M10) |

Mật khẩu: `grep MQTT_ infra/pi/.env`.

## Kiểm tra sau khi cài

```bash
docker compose -f infra/pi/docker-compose.yml --env-file infra/pi/.env ps      # 4 container
curl -s -o /tmp/hi.wav -w '%{http_code} %{content_type}\n' 'http://localhost:8080/voice/tts?text=Xin%20ch%C3%A0o&lang=vi'   # 200 audio/wav
curl -s http://localhost:8080/voice/stt                                        # {"on":true} khi brain.env có STT_API_KEY
tailscale serve status                                                         # https://….ts.net -> http://127.0.0.1:8080
docker compose -f infra/pi/docker-compose.yml --env-file infra/pi/.env logs vega-brain | tail   # "connected to mqtt://mosquitto:1883"
curl -s http://localhost:8080/config.js                                        # source: "mqtt"
```

Từ PC (cùng LAN), bắn một cảnh vào broker của Pi: màn Pi và mọi tab dashboard trên PC cùng đổi.

```bash
MQTT_URL=mqtt://<ip-pi>:1883 MQTT_USER=brain MQTT_PASS=<mật khẩu brain> npm run scene -- briefing
```

Mở dashboard trên PC bằng `http://<ip-tailscale-của-pi>:8080/` (mức `full`) để xem cùng một cảnh với Pi. Gõ
`phòng mấy độ, bật đèn giúp` trên thanh lệnh để thử bộ não (cần thiết bị thật, hoặc chạy `npm run sim` trỏ vào broker của Pi).

Thử giọng nói (M5): trên PC hoặc điện thoại trong tailnet, mở `https://<tên-máy-pi>.<tailnet>.ts.net`, giữ nút mic nói "phòng mấy
độ", thả ra: VEGAS hiện câu bạn nói, trả lời và đọc to bằng giọng tiếng Việt.

Thử camera (M7, M7.1): cắm camera USB, kiểm tra `ls /dev/video0` và `v4l2-ctl --list-formats-ext` (cần MJPEG). Gõ "xem camera":
màn Vision chạy video trực tiếp (log `vega-vision` ghi `[vision] camera on`). Đặt `LLM_VISION` trong `brain.env` (README, mục M7),
`docker compose … up -d vega-brain`, rồi hỏi "trên bàn có gì?". Log bộ não ghi `[vision] camera /hostdev/video0 ready`. Camera ở số khác (`/dev/video2`…): đặt `CAMERA_DEVICE=/hostdev/video2` trong `infra/pi/.env`. Nhóm `video` của
máy khác 44: đặt `VIDEO_GID` (xem `getent group video`).

## Backup (M8)

`setup.sh` cài `age` và `rclone`, tạo khoá backup và **in khoá bí mật đúng một lần**. Lưu ngay vào trình quản lý mật khẩu **và** thành
file `vega-backup-key.txt` trên PC. Pi chỉ giữ khoá công khai (`AGE_RECIPIENT` trong `.env`): ai lấy được thẻ nhớ hay file backup cũng
không đọc được.

- Mỗi đêm 03:30 (timer `vega-backup`): một file `vega-YYYYMMDD-HHMMSS.tar.gz.age` trong `BACKUP_DIR` (mặc định `/var/backups/vega`,
  nên đặt trên SSD), giữ 14 bản.
- Chạy tay và xem kết quả: `sudo ./infra/pi/backup.sh`, `systemctl list-timers 'vega-*'`, `journalctl -u vega-backup`.
- **Một bản ra khỏi Pi (khuyên dùng):** `rclone config` → tạo remote `gdrive` loại Google Drive (làm theo hướng dẫn trên màn hình, đăng
  nhập trên PC khi rclone hỏi) → thêm `RCLONE_REMOTE=gdrive:vega-backups` vào `infra/pi/.env`. Không đặt thì backup chỉ nằm trên Pi và
  Console ghi "on the Pi only".
- Thử giải mã một lần ngay sau khi cài, trên PC: `age -d -i vega-backup-key.txt vega-….tar.gz.age | tar -tzf -`.

## Dựng lại từ đầu (M8)

Thẻ nhớ hỏng, mua Pi mới, hay chỉ muốn chắc backup dùng được. Mục tiêu: dưới 1 giờ. Ghi lại thời gian thật của bạn vào bảng.

| Bước | Việc | Thời gian |
|---|---|---|
| 1 | Ghi Pi OS Lite 64-bit bằng Raspberry Pi Imager (cùng tên máy và user như cũ, bật SSH bằng khoá, đặt Wi-Fi nếu cần) | ~10 phút |
| 2 | Cài Tailscale và đăng nhập (`sudo tailscale up --hostname=vega`), xem "Tên trong tailnet" bên dưới | ~3 phút |
| 3 | `git clone` repo, chép file backup mới nhất (từ Google Drive hoặc ổ khác) và `vega-backup-key.txt` sang Pi | ~5 phút |
| 4 | `sudo ./infra/pi/setup.sh --restore vega-….tar.gz.age` (thêm `--kiosk` nếu Pi có màn hình; hỏi đường dẫn file khoá, hoặc đặt sẵn `AGE_KEY=…`) | ~25 phút (build) |
| 5 | Kiểm tra: `/status`, Console › Reminders còn lời nhắc cũ, hỏi "lịch hôm nay" (Google không cần đăng nhập lại), Console › Backup ghi "offsite" sau lần backup kế tiếp | ~5 phút |

`--restore` đặt lại `.env`, `brain.env`, `mosquitto/passwd` và cấu hình rclone (bản cũ giữ lại thành `*.before-restore`), nạp
`brain.db` và `google-token.json` vào volume của bộ não trước khi nó chạy, rồi làm tiếp như một lần cài thường. Khoá backup cũ vẫn
dùng tiếp, bản sao lên Google Drive cũng chạy tiếp mà không cần `rclone config` lại. Xong thì xoá `vega-backup-key.txt` khỏi Pi.

**Diễn tập (khi thẻ cũ vẫn tốt):** cài lên một thẻ hoặc SSD khác, cất thẻ cũ. Hỏng giữa chừng thì cắm lại thẻ cũ là về như trước.

**Tên trong tailnet:** máy cũ vẫn giữ tên `vega` trong Tailscale, nên máy mới sẽ thành `vega-1` và mọi đường dẫn (PWA trên điện
thoại, Console) đổi theo. Trước bước 2, vào trang Machines của Tailscale, đổi tên máy cũ thành `vega-old`. Dựng lại thành công thì xoá
`vega-old`. Phải lùi về thẻ cũ thì xoá máy mới rồi đổi `vega-old` về `vega`.

**SSH báo khoá máy đổi:** Pi mới có khoá SSH mới. Trên PC xoá khoá cũ (`ssh-keygen -R vega.<tailnet>.ts.net` và `-R <IP Tailscale>`)
rồi nối lại, so vân tay với dòng `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` trên màn hình Pi.

## Điện thoại: vị trí

**Cách đơn giản (không cài app):** mở VEGAS trên điện thoại (`https://<tên-máy-pi>.<tailnet>.ts.net`, hoặc bản đã cài lên màn hình
chính), cho phép **Vị trí** khi iPhone hay Android hỏi. Trang đang mở thì cứ 2 phút gửi vị trí của trình duyệt cho bộ não
(`POST /api/location`). Máy tính và kiosk trên Pi không bao giờ gửi. Giới hạn: trang web không lấy được vị trí khi đã đóng, nên chip
**AWAY** chỉ đổi khi bạn mở VEGAS trên điện thoại. Muốn theo dõi cả lúc không mở trang thì dùng OwnTracks bên dưới.

**Đặt nhà:** khi đang ở nhà, mở VEGAS trên điện thoại rồi nói hoặc gõ **"đây là nhà"**: vị trí điện thoại vừa gửi (mới hơn 10 phút,
sai số dưới 150 m) thành tâm vòng tròn nhà, lưu trong SQLite. Chưa đặt thì dùng `HOME_LAT` / `HOME_LON` trong `brain.env`, rồi tới toạ
độ thời tiết. Bán kính: `HOME_RADIUS_M` (mặc định 150 m).

### OwnTracks (theo dõi cả khi không mở trang)

1. Cài **Tailscale** trên điện thoại, đăng nhập cùng tailnet.
2. Cài **OwnTracks** (Android, iOS). *Preferences › Connection*: Mode **MQTT**, Host = địa chỉ Tailscale của Pi (`tailscale ip -4`),
   Port `1883`, TLS **tắt** (Tailscale đã mã hoá), Username `phone`, Password = `MQTT_PHONE_PASS` trong `infra/pi/.env`, User ID `vega`,
   Device ID tuỳ đặt (vd. `phone`).
3. *Regions*: thêm vùng tên **Nhà** quanh nhà (bán kính ~100 m). Không có vùng thì bộ não dùng vòng tròn `HOME_LAT` / `HOME_LON` /
   `HOME_RADIUS_M` (mặc định 150 m) trong `brain.env`, hoặc toạ độ thời tiết.
4. Hỏi "tôi đang ở đâu". Ra khỏi nhà vài phút thì header hiện **AWAY**. iPhone gửi vị trí thưa hơn khi app chạy nền, nên có thể trễ vài
   phút.

## Pi 3: người gác và thông báo điện thoại (M10)

Pi 3 đứng ngoài trông Pi 4 và giữ máy chủ thông báo **ntfy** (brief 0014). Pi 4 mất điện, treo hay rớt mạng quá 3 phút thì iPhone nhận
một tin khẩn; Pi 4 lên lại thì có tin "đã trở lại". Bộ não trên Pi 4 cũng đẩy Alert qua đây: lỗi sức khoẻ của Pi luôn gửi, CI hỏng và lời
nhắc chỉ gửi khi bạn **vắng nhà** (chip AWAY), Briefing 7:00 gửi nhẹ một dòng. Pi 3 im quá 5 phút thì màn VEGAS hiện Alert.

1. **Pi 4 trước:** `cd ~/vega && git pull && sudo ./infra/pi/setup.sh` (tạo user MQTT `watch`). Lấy mật khẩu của nó:
   `grep MQTT_WATCH_PASS ~/vega/infra/pi/.env`.
2. **Pi 3:** ghi **Pi OS Lite 64-bit** bằng Raspberry Pi Imager (bật SSH, nên cắm dây mạng và khác ổ điện với Pi 4), rồi:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --hostname=vega-watch
   sudo apt install -y git && git clone https://github.com/BanhKhuc04/vega.git ~/vega
   sudo ~/vega/infra/pi3/setup.sh
   ```
   Script hỏi tên Pi 4 trong tailnet (mặc định `vega`), mật khẩu `MQTT_WATCH_PASS`, và mật khẩu bạn chọn cho tài khoản ntfy `phone`.
3. Cuối script in **ba dòng `NTFY_…`**: dán vào `~/vega/infra/pi/brain.env` trên Pi 4 rồi `cd ~/vega/infra/pi && sudo docker compose up -d vega-brain`.
   Ba dòng này là bí mật, đừng dán chỗ khác.
4. **iPhone** (Tailscale đang bật): cài app **ntfy** từ App Store › Settings › Default server: `https://vega-watch.<tailnet>.ts.net` ›
   Users: thêm user `phone` với mật khẩu ở bước 2 › Subscribe topic script đã in. Cho phép thông báo khi iOS hỏi. Script đã gửi sẵn một
   tin thử "Pi 3 sẵn sàng".

Kiểm tra: `systemctl list-timers vega-watch`, `journalctl -u vega-watch -n 20`, Console › Hôm nay › **Pi 3 watchdog**. Thử thật: rút điện
Pi 4, đợi khoảng 4 phút, iPhone phải báo; cắm lại, có tin "đã trở lại". Cập nhật Pi 3: `cd ~/vega && git pull && sudo ./infra/pi3/setup.sh`.

Giới hạn: **mất điện hay mất internet cả nhà** thì Pi 3 cũng tắt hoặc không gửi được. iPhone báo tức thì nhờ ntfy chuyển một mã tin qua
máy chủ ntfy.sh tới Apple; nội dung tin vẫn đi thẳng từ Pi 3 sang iPhone qua Tailscale.

## Mất điện, rút điện cắm lại

Docker tự bật lại các container (`restart: unless-stopped`) và `vega-kiosk.service` tự mở trình duyệt. Kiosk chờ nginx
sẵn sàng rồi mới mở trang.

## Hiệu năng trên Pi 3 (cần kiểm tra thật)

- Mức `css` không tạo WebGL context, chỉ dùng transform CSS (mỗi vòng là một layer riêng).
- Mục tiêu của M0: kiosk ≥ 30 FPS, tổng RAM < 800 MB. Đo bằng `free -m` và `chrome://gpu`/`Performance` sau 1 giờ.
- Nếu vẫn giật: hạ thêm bằng cách bỏ tab khác, tăng zram, hoặc báo lại để giảm số vòng của quả cầu CSS.

## Gỡ

```bash
docker compose -f infra/pi/docker-compose.yml --env-file infra/pi/.env down
sudo systemctl disable --now vega-kiosk.service vega-backup.timer vega-health.timer
```
