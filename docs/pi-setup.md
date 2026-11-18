# Cài VEGA lên Raspberry Pi 3

Mục tiêu của M0: trên Pi, kiosk Chromium mở màn VEGA ở mức `css`, dữ liệu đi qua Mosquitto có mật khẩu.
Script `infra/pi/setup.sh` và `infra/pi/docker-compose.yml` được viết và kiểm tra cú pháp (`bash -n`, `shellcheck`,
`docker compose config`) **ngoài Pi**; lần chạy thật đầu tiên là của chủ dự án.

## Chuẩn bị

- Raspberry Pi OS Lite **64-bit** (Bookworm), thẻ nhớ ≥ 16 GB (khuyến nghị SSD qua USB), Ethernet hoặc Wi-Fi, màn hình HDMI.
- SSH vào Pi, `git clone` repo này (hoặc `rsync`).
- Pi và PC cùng mạng LAN. **Không** forward cổng 1883, 9001, 8080 ra internet (chưa có TLS).

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
| Mosquitto | `mosquitto/passwd` dựng lại từ `.env`; ACL ở `mosquitto/acl` |
| Stack | `infra/pi/docker-compose.yml`: `mosquitto` (64 MB), `vega-ui` nginx (48 MB), `restart: unless-stopped` |
| Kiosk | `cage` + Chromium, unit `vega-kiosk.service`, mở `http://localhost:8080/?quality=css` |

Biến môi trường tùy chọn của script: `KIOSK_URL`, `KIOSK_USER` (mặc định user đang chạy `sudo`, hoặc `pi`).
`--no-kiosk` bỏ qua phần kiosk.

## MQTT: người dùng và quyền

| User | Quyền | Dùng cho |
|---|---|---|
| `brain` | đọc/ghi `vega/#` | bộ não (M1), công cụ `npm run sim` / `npm run scene` |
| `ui` | đọc `vega/#`, ghi `vega/system/command` | dashboard. Mật khẩu này nằm trong `/config.js` nên ai mở được dashboard trong LAN đều thấy: vì vậy nó không ghi được gì khác |
| `device` | ghi `state`, `meta`, `availability`; đọc `set` | ESP. Từng thiết bị riêng có ở M2 |

Mật khẩu: `grep MQTT_ infra/pi/.env`.

## Kiểm tra sau khi cài

```bash
docker compose -f infra/pi/docker-compose.yml --env-file infra/pi/.env ps      # 2 container, healthy
curl -s http://localhost:8080/config.js                                        # source: "mqtt"
```

Từ PC (cùng LAN), bắn một cảnh vào broker của Pi: màn Pi và mọi tab dashboard trên PC cùng đổi.

```bash
MQTT_URL=mqtt://<ip-pi>:1883 MQTT_USER=brain MQTT_PASS=<mật khẩu brain> npm run scene -- briefing
```

Mở dashboard trên PC bằng `http://<ip-pi>:8080/` (mức `full`) để xem cùng một cảnh với Pi.

## Mất điện, rút điện cắm lại

Docker tự bật lại hai container (`restart: unless-stopped`) và `vega-kiosk.service` tự mở trình duyệt. Kiosk chờ nginx
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
