# Màn nhỏ 2.8" và nút xoay (hộp homeserver)

Mặt trước hộp homeserver (`homeserver-rack`) có một màn TFT 2.8" SPI ILI9341 320×240, **không cảm ứng**, và một nút xoay
EC11 có nhấn. Pi 4 mở trang `/mini` (`dashboard/mini.html`) trên màn này ở chế độ kiosk.

| Thao tác | Tác dụng |
|---|---|
| Xoay | Chuyển trang: Phòng → Pi 4 → Việc tiếp theo → Lệnh nhanh. Trong danh sách hoặc hộp hỏi: chọn mục |
| Nhấn | Mở Lệnh nhanh, gửi lệnh đang chọn, trả lời hộp hỏi |
| Giữ 0.6 giây | Quay lại (thoát danh sách, đóng hộp hỏi, về trang Phòng) |

Khi brain hỏi xác nhận (cảnh `alert` có `confirm`), màn hiện hai lựa chọn **Huỷ / Đồng ý** và mặc định chọn Huỷ, nên lỡ tay
nhấn cũng không xác nhận. Lời nhắc (`snooze`) cho chọn **Đã xem / Báo lại 10 phút**. Câu trả lời của brain và lời nhắc hiện
thành dòng thông báo ở cuối màn.

Trên PC, mở `http://localhost:5173/mini.html` (`npm run dev` hoặc `npm run vega`) và dùng phím mũi tên, Enter, Esc thay cho núm.

## Nối dây (số chân BCM, chân vật lý trong ngoặc)

| Màn ILI9341 | Pi 4 |
|---|---|
| VCC | 3.3V (1) |
| GND | GND (6) |
| CS | GPIO8 / CE0 (24) |
| RESET | GPIO24 (18) |
| DC | GPIO25 (22) |
| SDI (MOSI) | GPIO10 (19) |
| SCK | GPIO11 (23) |
| LED | GPIO18 (12) |
| SDO (MISO) | không nối |

| Nút xoay EC11 | Pi 4 |
|---|---|
| A (CLK) | GPIO17 (11) |
| B (DT) | GPIO27 (13) |
| C (chân giữa, chung) | GND (14) |
| Nút nhấn, chân 1 | GPIO22 (15) |
| Nút nhấn, chân 2 | GND (9) |

Không cần điện trở: dịch vụ bật điện trở kéo lên trong Pi. Nếu module màn có thêm chân cảm ứng (T_CLK, T_CS…), để trống.

## Cài trên Pi 4

```bash
cd ~/vega && git pull
sudo ./infra/pi/setup.sh --mini-screen
sudo reboot
```

Lệnh này thêm vào hệ thống:
- Overlay `vega-ili9341` (`infra/pi/mini-screen/vega-ili9341.dts`) và hai dòng `dtparam=spi=on`, `dtoverlay=vega-ili9341`
  vào `/boot/firmware/config.txt`. Màn chạy bằng driver DRM `mi0283qt` có sẵn trong kernel (panel ILI9341).
- Dịch vụ `vega-knob` (`mini-screen/knob.py`): đọc nút xoay qua GPIO rồi giả lập phím mũi tên, Enter, Esc qua `/dev/uinput`.
- Kiosk mở `http://localhost:8080/mini` qua `vega-kiosk-mini` (`mini-screen/kiosk-mini.sh`). Script này chỉ vẽ lên màn SPI,
  vẽ bằng phần mềm (pixman), nên cổng HDMI vẫn trống.

## Kiểm tra và sửa lỗi

**Chưa thử trên phần cứng thật.** Lần cài đầu tiên do bạn chạy. Nếu có trục trặc:

| Triệu chứng | Kiểm tra |
|---|---|
| Màn trắng hoặc đen | `ls /sys/class/drm/` phải có một card dùng driver `mi0283qt` (`readlink -f /sys/class/drm/card*/device/driver`). Không có: kiểm tra dây CS, DC, RESET và `dmesg \| grep -i mi0283` |
| Hình ngược hoặc lệch | Sửa `rotation = <90>` thành `<270>` trong file `.dts`, chạy lại setup, reboot |
| Màu sai (xanh và đỏ đổi chỗ) | Module này có thể dùng thứ tự RGB khác. Báo lại để chuyển sang driver `panel-mipi-dbi` có cấu hình riêng |
| Kiosk không lên | `journalctl -u vega-kiosk -n 50`. Dòng "no mi0283qt display found" nghĩa là overlay chưa nạp |
| Xoay ngược chiều | Đổi chỗ hai dây A và B, hoặc đặt `Environment=VEGA_KNOB_PINS=27,17,22` trong `vega-knob.service` |
| Xoay không ăn | `journalctl -u vega-knob -n 20`; thử `sudo evtest` và chọn thiết bị `vega-knob` |

Muốn quay lại màn HDMI: `sudo ./infra/pi/setup.sh` (không có `--mini-screen`) sẽ viết lại kiosk về trang chính, rồi xoá
dòng `dtoverlay=vega-ili9341` trong `config.txt` và `sudo systemctl disable --now vega-knob`.
