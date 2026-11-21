# Cài VEGA lên Raspberry Pi 3

Mục tiêu: trên Pi, kiosk Chromium mở màn VEGA ở mức `css`, dữ liệu đi qua Mosquitto có mật khẩu, `vega-brain` (M1) trả lời
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
độ", thả ra: VEGA hiện câu bạn nói, trả lời và đọc to bằng giọng tiếng Việt.

Thử camera (M7, M7.1): cắm camera USB, kiểm tra `ls /dev/video0` và `v4l2-ctl --list-formats-ext` (cần MJPEG). Gõ "xem camera":
màn Vision chạy video trực tiếp (log `vega-vision` ghi `[vision] camera on`). Đặt `LLM_VISION` trong `brain.env` (README, mục M7),
`docker compose … up -d vega-brain`, rồi hỏi "trên bàn có gì?". Log bộ não ghi `[vision] camera /hostdev/video0 ready`. Camera ở số khác (`/dev/video2`…): đặt `CAMERA_DEVICE=/hostdev/video2` trong `infra/pi/.env`. Nhóm `video` của
máy khác 44: đặt `VIDEO_GID` (xem `getent group video`).

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
sudo systemctl disable --now vega-kiosk.service
```
