# Decision Brief 0008 — M5 · Giọng nói dùng được ở mọi nơi

| | |
|---|---|
| **Ngày** | 2026-11-19 |
| **Trạng thái** | Đã duyệt (2026-11-19) |
| **Dựa trên** | 0002 (phương án 1.0, mục M5, D7, D9), PR #5 (giọng nói của trình duyệt), PR #9 (VEGA chạy trên Pi 4) |
| **Nhánh** | `feat/m5-voice`, từ `main` |

## 1. Vấn đề

Giọng nói hiện dựa hoàn toàn vào **trình duyệt** (Web Speech API), nên chập chờn:

| Triệu chứng | Nguyên nhân |
|---|---|
| Mở VEGA trên Pi (`http://100.87.86.18:8080`) thì mic không chạy | Trình duyệt chỉ cho dùng mic trên trang **HTTPS** hoặc `localhost`. Địa chỉ Tailscale đang là `http` |
| Lúc đọc to được, lúc im lặng | Câu tiếng Việt cần giọng `vi` cài trong máy. PC không có, nên câu tiếng Anh được đọc, câu tiếng Việt thì im. Điện thoại và kiosk Pi mỗi máy một kiểu |
| Điện thoại iPhone, kiosk Chromium trên Pi không nghe được | Hai trình duyệt này không có nhận dạng giọng nói (SpeechRecognition) |
| Nghe được nhưng phụ thuộc Google/Microsoft | Chrome gửi âm thanh lên Google, Edge gửi lên Microsoft; không chọn được, không đo được |

## 2. Mục tiêu

**Đọc và nghe do VEGA làm**, không phụ thuộc trình duyệt. Mở VEGA trên PC, điện thoại hay Pi đều nói và nghe được tiếng Việt như nhau.

**Xong khi:** mở `https://vega.<tailnet>.ts.net` trên PC hoặc điện thoại, giữ nút mic nói "phòng mấy độ", thả ra. Trong vòng
khoảng 4 giây (D7) VEGA hiện câu bạn nói, trả lời, và **đọc to câu trả lời bằng giọng tiếng Việt**, kể cả trên máy không cài giọng
tiếng Việt nào. Rút mic hoặc từ chối quyền mic thì màn hình nói rõ lý do.

## 3. Quyết định

| # | Quyết định |
|---|---|
| V1 | **HTTPS qua Tailscale.** `tailscale serve` cấp HTTPS với chứng chỉ thật cho tên `vega.<tailnet>.ts.net`, chỉ trong mạng Tailscale của bạn, không mở ra internet. Nhờ đó trình duyệt cho dùng mic. `setup.sh` có thêm bước tuỳ chọn để bật. Trên PC dev, `localhost` vẫn dùng được mic như cũ |
| V2 | **MQTT cùng địa chỉ với trang.** Trang HTTPS không được nối `ws://…:9001` (mixed content), nên nginx của `vega-ui` chuyển `/mqtt` sang Mosquitto, và dashboard dùng `wss://<cùng host>/mqtt` khi trang là HTTPS |
| V3 | **Đọc to bằng Piper, chạy offline trên Pi** (container mới `vega-voice`, giọng tiếng Việt `vi_VN-vais1000-medium` và giọng tiếng Anh). Bộ não không đổi: dashboard xin âm thanh của câu trả lời qua `GET /voice/tts?text=…&lang=vi` (cùng host, qua nginx), nhận file WAV và phát. Miễn phí, không gửi gì ra ngoài. Không có `vega-voice` (PC dev chưa bật) thì quay về giọng của trình duyệt như hiện nay |
| V4 | **Nghe bằng Whisper trên cloud** (lớp `stt` trung lập như lớp `llm`, API OpenAI-compatible `/audio/transcriptions`). Đề xuất Groq `whisper-large-v3-turbo`: rẻ và nhanh, có gói miễn phí. Lý do không chạy Whisper trên Pi 4: model đủ tốt cho tiếng Việt chạy quá chậm, không đạt 4 giây. Có trần riêng `STT_MAX_MIN_DAY` (phút ghi âm mỗi ngày, mặc định 30) và vẫn tính vào trần ngày `BUDGET_USD_DAY` |
| V5 | **Bấm giữ để nói** (push-to-talk): giữ nút mic (hoặc phím Space khi ô nhập trống) thì ghi âm bằng `MediaRecorder`, thả ra thì gửi `POST /voice/stt` → chữ → lệnh như khi gõ. Tối đa 15 giây mỗi lần. Chưa có "Hey Vega", vì cần mic luôn mở và model riêng |
| V6 | **Đường âm thanh**: `vega-voice` là một dịch vụ HTTP nhỏ (Python, Piper + client STT), chỉ nghe trong mạng Docker, nginx chuyển `/voice/` vào. Key STT nằm trong `brain.env` của Pi, không bao giờ tới trình duyệt. Mỗi request kiểm tra độ dài chữ (≤ 500 ký tự) và âm thanh (≤ 15 giây, ≤ 1 MB) |
| V6′ | *Sửa khi triển khai (2026-11-20):* **nghe (STT) nằm trong bộ não**, không nằm trong `vega-voice`. Bộ não mở `POST /voice/stt` (chỉ trong mạng Docker, `VOICE_PORT=8091`), nginx chuyển `/voice/stt` vào bộ não, `/voice/tts` vào `vega-voice`. Lý do: trần `BUDGET_USD_DAY` và sổ chi phí SQLite nằm ở bộ não (V4), và PC dev không có Docker vẫn nghe được (mục 7.3). `vega-voice` chỉ còn Piper. Đường đi, giới hạn và việc giữ key không đổi |
| V7 | **Báo lỗi rõ ràng** (D9): chưa cho quyền mic, không có mic, trang không phải HTTPS, STT hết trần ngày, mất mạng — mỗi lỗi một câu trong khung chat, nút mic đổi trạng thái. Không bao giờ im lặng |
| V8 | **Ngôn ngữ đọc**: câu có dấu tiếng Việt thì dùng giọng Việt, còn lại giọng Anh (như hiện nay). Câu trả lời dài chỉ đọc phần `speak` (đã có từ M6) |

## 4. Scope

W1 nginx `/mqtt` + dashboard tự dùng `wss` khi trang HTTPS · W2 `tailscale serve` trong `setup.sh` (tuỳ chọn) + tài liệu · W3 container
`vega-voice`: Piper (vi + en), `GET /voice/tts`, giới hạn đầu vào · W4 `POST /voice/stt` qua provider OpenAI-compatible, đếm phút theo ngày
· W5 dashboard: phát âm thanh từ `vega-voice` (quay về giọng trình duyệt nếu không có), bấm giữ để nói với `MediaRecorder` · W6 báo
lỗi mic/quyền/HTTPS/trần · W7 test (unit, e2e với `vega-voice` giả), README, `docs/security.md`, `docs/pi-setup.md` cập nhật cho Pi 4.

**Ngoài phạm vi:** wake word "Hey Vega", mic gắn trên Pi (nút bấm vật lý, nhận biết rút mic qua USB), `pc-agent` (phím tắt toàn cục,
Wake-on-LAN, tắt máy), Whisper chạy offline, nhiều giọng tuỳ chọn. Những phần này để M5.2 khi có mic USB.

## 5. Definition of Done

- [ ] Trang HTTPS nối được MQTT qua `wss://<host>/mqtt`; trang `http://localhost` vẫn dùng `ws://…:9001` như cũ (e2e).
- [ ] `GET /voice/tts?text=Xin chào&lang=vi` trả WAV đọc được; chữ > 500 ký tự hoặc `lang` lạ bị từ chối (test).
- [ ] Trên máy không có giọng tiếng Việt, câu trả lời tiếng Việt vẫn được đọc to (e2e: dashboard phát âm thanh từ `vega-voice` giả, không gọi `speechSynthesis`).
- [ ] Bấm giữ nút mic → ghi âm → `POST /voice/stt` (STT giả) → chữ hiện trong ô "You" → VEGA trả lời (e2e với mic giả của Chromium).
- [ ] Từ chối quyền mic, không có mic, trang `http` không phải localhost, STT hết trần: mỗi trường hợp có câu báo trong chat (unit).
- [ ] Key STT không xuất hiện trong log, lỗi hay trang web (test).
- [ ] lint, check, unit, e2e đều xanh. CI xanh.
- [ ] *(Chủ dự án)* Bật `tailscale serve` trên Pi, mở `https://vega.<tailnet>.ts.net` trên PC và điện thoại, nói "phòng mấy độ", nghe trả lời bằng tiếng Việt.

## 6. Việc của chủ dự án

1. Trên trang quản trị Tailscale: bật **MagicDNS** và **HTTPS Certificates** (một lần).
2. Tạo key STT (đề xuất Groq: console.groq.com, gói miễn phí), thêm vào `infra/pi/brain.env`.
3. Chạy lại `setup.sh` trên Pi để build `vega-voice` và bật `tailscale serve`.

## 7. Câu hỏi mở

1. **Giọng Piper tiếng Việt** (`vi_VN-vais1000-medium`) nghe rõ nhưng hơi "máy". Nếu không thích, có thể đổi sang TTS cloud (tốn tiền
   theo ký tự) ở bản sau. Đề xuất thử Piper trước vì miễn phí và chạy offline.
2. **STT trên cloud nghĩa là âm thanh lời bạn nói được gửi tới nhà cung cấp** (đề xuất Groq). Chỉ khi bạn bấm giữ nút mic; không có
   chế độ nghe liên tục. README và `docs/security.md` sẽ ghi rõ.
3. **PC dev** (`npm run vega`) không có Docker nên không có `vega-voice`: đọc to quay về giọng trình duyệt, nghe dùng STT cloud trực
   tiếp từ bộ não dev nếu có key. Muốn có Piper trên PC thì chạy `docker compose` riêng cho `vega-voice`.
