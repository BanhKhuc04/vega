# pc-agent: "Hey Vegas" trên PC (M5.2)

Brief: `docs/decisions/0009-m5.2-wake-word.md`.

Chương trình Python nhỏ, luôn nghe mic của PC nhưng **chỉ trên máy**: một model wake word chờ chữ gọi VEGA. Nghe thấy thì:

1. kêu "bíp", ghi câu lệnh tới khi bạn im lặng 0,7 giây (tối đa 10 giây; không nói gì trong 3 giây thì bỏ, không gửi gì);
2. gửi âm thanh tới `/voice/stt` của bộ não (agent **không giữ key nào**, mọi trần chi phí vẫn áp dụng);
3. publish lệnh lên `vega/system/command` với `via: "voice"`, chờ câu trả lời;
4. đọc câu trả lời bằng Piper (`vega-voice`) ra loa PC; màn hình hiện câu hỏi và câu trả lời trong khung chat;
5. nghe tiếp 6 giây: câu tiếp theo không cần gọi lại. Trong lúc VEGA đang đọc, agent không nghe.

`Ctrl+Alt+M` đóng mic thật sự (màn hình hiện **MIC OFF**), bấm lần nữa để mở. Rút mic thì màn hình hiện **NO MIC**, agent thử mở
lại mỗi 5 giây.

## Cài và chạy (Windows)

Cần: Python 3.10+ (`py -3`), PC đang bật Tailscale (bộ não, broker và Piper chạy trên Pi), và model "Hey Vegas" (mục dưới).

1. Trên Pi: `cd ~/vega && git pull && sudo ./infra/pi/setup.sh` (tạo user MQTT `agent`), rồi lấy mật khẩu:
   `sudo grep MQTT_AGENT_PASS ~/vega/infra/pi/.env`.
2. Trong `pc-agent\.env` (script dưới chép từ `.env.example` nếu chưa có): thay `<tailnet>` bằng tên Pi trong Tailscale, dán mật khẩu vào
   `MQTT_PASS=`. Mật khẩu này là bí mật: chỉ để trong `.env` (git bỏ qua file này).

```powershell
powershell -ExecutionPolicy Bypass -File pc-agent\install-windows.ps1
```

Script tạo `pc-agent\.venv`, cài thư viện, chép `.env.example` thành `.env`, rồi đăng ký task **VEGA pc-agent** chạy ẩn mỗi lần
đăng nhập Windows và chạy luôn. Log: `pc-agent\agent.log`. Gỡ: thêm `-Uninstall`.

Chạy tay (thấy log ngay, Ctrl+C để dừng). Dừng task trước để hai bản không cùng nghe mic:

```powershell
Stop-ScheduledTask -TaskName 'VEGA pc-agent'
pc-agent\.venv\Scripts\python pc-agent\main.py
```

Lần chạy đầu tải model của openWakeWord (vài MB, từ GitHub của dự án) vào thư mục của thư viện.

## Cấu hình: `pc-agent\.env`

| Biến | Mặc định | |
|---|---|---|
| `WAKE_MODEL` | `hey_jarvis` | File của bạn (`.env.example`: `models/hey_vegas.onnx`) hoặc tên model có sẵn (`hey_jarvis`, `alexa`, `hey_mycroft`, `hey_rhasspy`) |
| `WAKE_THRESHOLD` | `0.5` | 0–1. Cao hơn: ít thức nhầm hơn nhưng phải nói rõ hơn |
| `FOLLOW_UP_S` | `6` | Số giây nói tiếp không cần gọi lại |
| `HOTKEY` | `ctrl+alt+m` | Phím đóng/mở mic. Để trống để tắt |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | Broker. Với Pi qua Tailscale: `wss://vega.<tailnet>.ts.net/mqtt` |
| `MQTT_USER`, `MQTT_PASS` | trống | Với Pi: `agent` và `MQTT_AGENT_PASS` của Pi. User này chỉ gửi được lệnh và trạng thái mic |
| `VEGA_STT_URL` | `http://127.0.0.1:8091/voice/stt` | `/voice/stt` của bộ não |
| `VEGA_TTS_URL` | `http://127.0.0.1:5002/voice/tts` | `vega-voice`. Để trống: chỉ hiện chữ, không đọc |

## Huấn luyện "Hey Vegas"

openWakeWord có notebook huấn luyện tự động chạy trên Google Colab (miễn phí). Dữ liệu là giọng tổng hợp, bạn **không cần ghi âm**.

1. Mở phần **Training New Models** trong README của [openWakeWord](https://github.com/dscripka/openWakeWord#training-new-models),
   bấm link notebook huấn luyện tự động để mở nó trên Colab.
2. Chọn **Runtime → Change runtime type → GPU** (nhanh hơn nhiều).
3. Ở ô cấu hình, đặt cụm từ là `hey vegas` (chữ thường, đọc kiểu tiếng Anh). Giữ các thông số khác như mặc định.
4. **Runtime → Run all**. Chờ khoảng 1 giờ.
5. Tải file `.onnx` mà notebook tạo ra, đổi tên thành `hey_vegas.onnx`, đặt vào `pc-agent\models\`.
6. Trong `pc-agent\.env`: `WAKE_MODEL=models/hey_vegas.onnx`, rồi chạy lại agent (hoặc khởi động lại task).
7. Thử: mở YouTube hoặc TV 1 giờ cạnh mic. Thức nhầm quá 1 lần thì tăng `WAKE_THRESHOLD` (0.6, 0.7…). Chữ "Vegas" hay có trên
   TV (Las Vegas), nên bước này quan trọng.

"VEGA ơi" chưa chắc nhận đúng vì notebook dùng giọng tổng hợp tiếng Anh (brief 0009, câu hỏi mở 2).

## Test

```bash
python -m unittest discover pc-agent         # không cần mic hay model: âm thanh giả
PC_AGENT_PYTHON=pc-agent/.venv/Scripts/python npm test   # thêm test tích hợp: agent thật đọc fixtures/hey-jarvis-bat-den.wav
```

`fixtures/hey-jarvis-bat-den.wav` là Piper đọc "Hey Jarvis! … Bật đèn phòng khách." (16 kHz mono).
