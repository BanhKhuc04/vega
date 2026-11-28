# VEGAS

> Trước 2026-11-23 tên là VEGA. Đổi tên chỉ ở những gì bạn thấy và nghe (màn hình, câu trả lời, thông báo điện thoại, "Hey Vegas");
> phần bên trong vẫn là `vega`: repo, topic MQTT `vega/…`, container, tên máy Tailscale, thư mục `~/vega`. Các brief cũ trong
> `docs/decisions` giữ tên cũ.

Trợ lý cá nhân chạy 24/7 trên hai Raspberry Pi, có màn hình FUI ở bàn và trên PC. Dự án chia hai phần (brief 0016):

| Phần | Máy | Làm gì | Hiện tại |
|---|---|---|---|
| **Bộ não** | Pi 4 | MQTT, `vega-brain`, giọng nói, camera, dashboard, trí nhớ | Tạm để yên, chỉ sửa lỗi (mốc M) |
| **Hạ tầng** | Pi 3 | Gác Pi 4, ntfy; sắp tới: trạm điều hành, DNS, cổng Zigbee và Bluetooth, tai vệ tinh | Đang phát triển (mốc P3.x) |

Phần dưới đây là ghi chú gốc của M1. Bản này là **M1 · Bộ não v1**
(trên nền **M0 · Nền móng**): `vega-brain` nhận lệnh từ thanh lệnh, hiểu lệnh (cục bộ trước, AI sau), gọi tool thiết bị và điều
khiển màn hình qua `vega/ui/scene`. Chưa có giọng nói, Telegram, Google, GitHub, phần cứng thật
(xem `docs/decisions/0002-vega-product-plan-1.0.md`, `0004-m1-brain.md`).

> Chữ trên giao diện giữ tiếng Anh như template; tài liệu và ghi chú dự án bằng tiếng Việt.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `packages/contract` | topic MQTT, schema payload (zod) và **giao thức cảnh** `vega/ui/scene` cho 11 template. Nơi duy nhất định nghĩa hợp đồng |
| `dashboard` | màn VEGAS Core (template `design/final:vega/`: Three.js + GSAP), lớp dữ liệu, bộ vẽ cảnh |
| `tools/sim` | thiết bị ảo, `npm run scene`, broker MQTT chạy trong tiến trình (không cần Docker) |
| `infra` | compose cho dev và cho Pi (Mosquitto có mật khẩu + ACL, nginx), `setup.sh` |
| `brain` | `vega-brain` (Node 22, TypeScript): sổ thiết bị, định tuyến cục bộ, cổng LLM + provider `mock`, SQLite (nhật ký lệnh, sổ chi phí), bảo mật lệnh, bench chọn nhà cung cấp AI |
| `pc-agent`, `firmware` | chỗ giữ chỗ cho các mốc sau (M5, M2) |
| `docs` | hợp đồng, hướng dẫn Pi, các Decision Brief |

## Chạy thử (PC)

Cần Node.js 22.

### Dùng VEGAS: một lệnh

```bash
npm ci
npm run vega         # broker + thiết bị ảo + bộ não (đọc .env) + màn VEGAS, trong một tiến trình. Mở địa chỉ nó in ra
```

Gõ vào ô **Ask VEGAS…** rồi Enter, hoặc **giữ nút mic** (hay phím Space khi ô nhập trống) để nói, thả ra để gửi. Chạm nhanh một
lần thì nghe tới khi chạm lần nữa (tối đa 15 giây). Câu hỏi và câu trả lời hiện trong khung trò chuyện
phía trên ô nhập, và VEGAS **đọc to** câu trả lời (nút loa để bật/tắt). Hành động cần xác nhận hiện thẻ có nút **Confirm / Cancel**.

| | Yêu cầu |
|---|---|
| Nhắn | trình duyệt nào cũng được |
| Đọc to | mở từ Pi: giọng **Piper** chạy offline trên Pi, máy nào cũng như nhau (M5). Trên PC dev: giọng có sẵn của máy (câu tiếng Việt cần giọng tiếng Việt: Edge có sẵn, hoặc thêm trong Windows Settings › Time & language › Speech; không có thì VEGAS im lặng và báo trong khung chat), hoặc Piper nếu đặt `VOICE_TTS_URL` (mục M5) |
| Nói (mic) | trang **HTTPS** hoặc `localhost`, có internet. Có `STT_API_KEY`: bộ não nhận dạng (mọi trình duyệt có mic, kể cả iPhone). Không có: nhận dạng của Chrome/Edge (Google/Microsoft) |

AI dùng nhà cung cấp trong `.env` (`LLM_ROUTER`); không có thì chỉ chạy lệnh cục bộ. VEGAS chưa nhớ hội thoại: mỗi câu được xử lý riêng.
Cột phải của màn Idle có ô **AI budget · today**: số tiền AI đã dùng hôm nay, còn lại bao nhiêu so với trần `BUDGET_USD_DAY`, số lượt gọi
(lấy từ sổ chi phí của bộ não). Màn hẹp hơn 900 px thì hai cột số liệu ẩn đi.

### Theo dõi CI trên GitHub (M3)

Thêm vào `.env` (hoặc `infra/pi/brain.env` trên Pi):

```bash
GITHUB_TOKEN=github_pat_...        # fine-grained, CHỈ ĐỌC: Actions (read) + Metadata (read), chỉ cho các repo cần theo dõi
GITHUB_REPOS=owner/repo,owner/repo2
```

Bộ não hỏi GitHub mỗi 60 giây (dùng ETag: kết quả không đổi thì GitHub trả 304, không tốn hạn mức) và xét lần chạy
**đã hoàn tất mới nhất của từng workflow** trên nhánh mặc định.

| Việc | Kết quả |
|---|---|
| Build vừa hỏng | màn **Alert**: repo, workflow, commit, người push; nút **Explain** và **Open on GitHub** |
| Hỏi `sao fail` / `vì sao build lỗi` / `why did it fail` (hoặc bấm Explain) | VEGAS đọc khoảng 150 dòng log quanh lỗi và giải thích ngắn gọn. Không có AI thì trả lời bằng bước bị hỏng và dòng lỗi đầu tiên |
| Hỏi `ci thế nào` / `build status` | trạng thái các workflow, chạy cục bộ, 0 đồng |
| Gõ `/status` (hoặc `tình trạng hệ thống`) | Pi (nhiệt độ, CPU, RAM, uptime), thiết bị online, CI, AI budget hôm nay, chạy cục bộ |
| Build xanh lại | màn **Success** |
| GitHub không trả lời quá 5 phút | ô CI/CD ghi thêm `stale`; không bắn Alert giả |

Log và thông điệp commit do người khác viết, nên VEGAS coi chúng là dữ liệu ngoài: khi chúng có mặt thì không lệnh vật lý nào
được chạy (`docs/security.md`).

### Trợ lý cá nhân: lịch, mail, thời tiết, nhắc việc, Focus (M4)

| Gõ hoặc nói | Kết quả |
|---|---|
| `hôm nay có lịch gì`, `lịch ngày mai`, `sự kiện tiếp theo`, `what's on today` | lịch Google, trả lời cục bộ (0 đồng) |
| `có mail gì mới không`, `any new mail` | thư **chưa đọc trong Hộp thư chính** 24 giờ qua: người gửi và tiêu đề |
| `thời tiết thế nào`, `có mưa không` | Open-Meteo, theo toạ độ `WEATHER_LAT` / `WEATHER_LON` |
| `briefing`, `tóm tắt hôm nay` | màn **Briefing**: lịch hôm nay, mail, thời tiết, phòng, CI. Tự hiện mỗi ngày lúc `BRIEFING_AT` (mặc định `07:00`) |
| `nhắc tôi 3 giờ chiều gọi mẹ`, `nhắc tôi sau 20 phút uống nước`, `remind me at 5pm to call mom` | tới giờ: thẻ Alert có nút **Snooze 10 min**, và VEGAS đọc to. Lời nhắc lưu trong SQLite, khởi động lại không mất |
| `nhắc nhở của tôi`, `huỷ nhắc 2` | xem / huỷ lời nhắc |
| `tập trung 25 phút`, `focus for 1 hour`, `dừng tập trung` | màn **Focus**: build hỏng và lời nhắc chờ tới khi hết giờ rồi mới hiện |

Câu trả lời theo ngôn ngữ của câu hỏi. Briefing tự hiện thì dùng `VEGA_LANG` (mặc định `vi`). Những gì VEGAS tự nói (lời nhắc,
Briefing) hiện trong khung chat và được đọc to trên **mọi** màn đang mở.

**Kết nối Google (một lần, chỉ quyền đọc):**

1. [Google Cloud Console](https://console.cloud.google.com/) → tạo project → *APIs & Services › Library*: bật **Google Calendar API** và **Gmail API**.
2. *OAuth consent screen*: loại **External**, thêm email của bạn vào *Test users*. Nên bấm **Publish app** (sang *In production*): ở chế độ
   *Testing*, Google cho token hết hạn sau 7 ngày. App chưa xác minh nên lúc đăng nhập Google hiện cảnh báo, bấm *Advanced → Go to …* là được.
3. *Credentials › Create credentials › OAuth client ID*, loại **Desktop app**. Chép vào `.env`:
   ```bash
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-...
   WEATHER_LAT=21.03          # tuỳ chọn, làm tròn 2 chữ số là đủ
   WEATHER_LON=105.85
   ```
4. `npm run google-login`: trình duyệt mở trang Google, bạn đồng ý quyền **chỉ đọc** lịch và Gmail. Token được lưu vào `google-token.json`
   (cạnh `BRAIN_DB`, quyền file `600`, đã có trong `.gitignore`). Chạy lại `npm run vega`.
5. Trên Pi (không có trình duyệt): đăng nhập trên PC, mở `google-token.json`, chép giá trị `refresh_token` vào `infra/pi/brain.env`
   thành `GOOGLE_REFRESH_TOKEN=...` (cùng `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), rồi `docker compose up -d vega-brain`.

VEGAS chỉ lấy phần đầu thư (`format=metadata`), không bao giờ tải nội dung thư, không gửi mail, không sửa lịch. Tiêu đề lịch và mail
là dữ liệu ngoài: dù có ghi "tắt hết thiết bị" cũng không điều khiển được gì (`docs/security.md`).

### Nghiên cứu có nguồn (M6)

Gõ hoặc nói `nghiên cứu …`, `tìm hiểu …`, `so sánh …`, `research …` (hoặc `/research …`). VEGAS:
1. nhờ AI đề ra tối đa 3 câu tìm;
2. tìm trên web bằng Tavily, giữ tối đa 8 trang (tối đa 2 trang mỗi website);
3. nhờ AI viết câu trả lời ngắn kèm trích dẫn `[1] [2] [3]`.

Màn **Research** hiện từng bước. Câu so sánh có thêm bảng. Trong khung chat, mỗi nguồn là một link mở ở tab mới. VEGAS chỉ đọc to phần
tóm tắt.

- **Trích dẫn kiểm tra được:** số trích dẫn không có thật bị xoá, URL do AI tự viết bị xoá, link luôn lấy từ kết quả tìm. Dưới 3
  website thì câu trả lời ghi rõ "chỉ tìm được N nguồn".
- **Chi phí:**
  - Mỗi lần nghiên cứu tối đa `RESEARCH_MAX_USD` (mặc định $0.01) và vẫn chịu trần ngày. VEGAS bớt nguồn cho vừa trần.
  - Tìm web tối đa `SEARCH_MAX_MONTH` lượt mỗi tháng (mặc định 900, dưới 1.000 credit miễn phí của Tavily).
  - Câu trả lời ghi số nguồn và tiền đã tốn.
- **Tra nhanh:** trong câu hỏi thường, AI được tìm web **một lần** khi cần thông tin mới (giá, phiên bản, tin tức). Câu trả lời kèm link.
- **Bật tính năng:**
  1. Tạo tài khoản miễn phí ở [tavily.com](https://tavily.com) (không cần thẻ).
  2. Thêm `TAVILY_API_KEY=tvly-...` vào `.env` (trên Pi là `infra/pi/brain.env`).
  3. Model riêng cho nghiên cứu là tuỳ chọn: `LLM_RESEARCH=<provider>`, mặc định dùng provider của `LLM_CHAT`.

Câu hỏi nghiên cứu được gửi tới Tavily và nhà cung cấp AI. Nội dung trang web là dữ liệu ngoài: không lệnh nào trong đó điều khiển
được thiết bị hay lời nhắc (`docs/security.md`).

### Giọng nói dùng được ở mọi nơi (M5)

**Đọc to** bằng [Piper](https://github.com/OHF-Voice/piper1-gpl) trong container `vega-voice` trên Pi: giọng tiếng Việt
`vi_VN-vais1000-medium`, tiếng Anh `en_US-lessac-medium`, chạy offline, không gửi gì ra ngoài. Dashboard xin
`GET /voice/tts?text=…&lang=vi|en` trên chính địa chỉ của trang (nginx chuyển vào `vega-voice`). Không có `vega-voice` thì quay về
giọng của trình duyệt. Muốn có Piper trên PC dev:

```bash
docker build -f voice/Dockerfile -t vega-voice . && docker run -d -p 127.0.0.1:5002:5002 vega-voice
VOICE_TTS_URL=http://127.0.0.1:5002 npm run vega
```

**Nghe** bằng Whisper trên cloud qua bộ não (Groq `whisper-large-v3-turbo`: rẻ, nhanh, có gói miễn phí). Giữ mic → trình duyệt ghi âm
tối đa 15 giây → `POST /voice/stt` → bộ não gửi tới nhà cung cấp → chữ hiện ở ô "You" → VEGAS trả lời như khi gõ.

1. Tạo key ở [console.groq.com](https://console.groq.com) (gói miễn phí).
2. Thêm vào `.env` (trên Pi là `infra/pi/brain.env`):
   ```
   STT_API_KEY=gsk_...
   STT_USD_PER_HOUR=0.04          # giá mỗi giờ âm thanh (trang giá của nhà cung cấp); bắt buộc để giữ trần ngày
   # STT_PROVIDER=groq            # hoặc openai (+ STT_MODEL=whisper-1, STT_USD_PER_HOUR=0.36), hoặc STT_BASE_URL riêng
   # STT_MAX_MIN_DAY=30           # phút ghi âm mỗi ngày, không bao giờ vượt
   # STT_LANGUAGE=vi              # ngôn ngữ bạn nói; để trống thì Whisper tự đoán (câu tiếng Việt ngắn dễ bị nghe sai)
   # STT_PROMPT=phòng ngủ, bếp, đèn bàn   # từ cần nghe đúng (tên phòng, thiết bị); mặc định là các câu lệnh của VEGAS
   ```
3. Khởi động lại bộ não. Log có dòng `[voice] /voice/stt on … speech to text groq whisper-large-v3-turbo`.

Mỗi lần nghe tính vào `STT_MAX_MIN_DAY` **và** trần ngày `BUDGET_USD_DAY` (ô AI budget trên màn cộng cả tiền nghe). Âm thanh chỉ được
gửi đi khi bạn giữ (hoặc chạm) nút mic; không có chế độ nghe liên tục, "Hey Vegas" ở mục dưới.

**Mic trên điện thoại và PC khác** cần trang HTTPS. Trên Pi, `setup.sh` bật `tailscale serve`: mở
`https://<tên-máy-pi>.<tailnet>.ts.net` (chỉ trong mạng Tailscale của bạn, không mở ra internet). Cần bật **MagicDNS** và
**HTTPS Certificates** một lần trong trang quản trị Tailscale (mục DNS). Đổi tên máy Pi thành `vega` trong trang quản trị để có
`https://vega.<tailnet>.ts.net`.

Mic gặp sự cố thì khung chat nói rõ: chưa cho quyền mic, không có mic, mic đang bị app khác dùng, trang không phải HTTPS, hết phút
hoặc hết trần ngày, mất mạng, chưa có `STT_API_KEY`.

### "Hey Vegas": nói không cần bấm (M5.2)

`pc-agent` là chương trình Python nhỏ chạy trên PC, luôn nghe mic nhưng **chỉ trên máy**: một model wake word
([openWakeWord](https://github.com/dscripka/openWakeWord)) chờ chữ "Hey Vegas" (model tự huấn luyện, không cần
ghi âm; trước khi có model thì dùng "Hey Jarvis" có sẵn). Nghe thấy thì kêu "bíp", ghi câu lệnh tới khi bạn im lặng 0,7 giây, gửi `/voice/stt` của bộ não (agent không giữ key nào),
ra lệnh qua MQTT, rồi đọc câu trả lời bằng Piper ra loa PC. Sau câu trả lời có 6 giây để nói tiếp mà không cần gọi lại.
Màn hình chuyển sang Listen khi agent nghe thấy wake word, và hiện câu hỏi, câu trả lời trong khung chat.

Agent nói chuyện với bộ não trên Pi qua Tailscale, bằng user MQTT riêng `agent` (chỉ gửi được lệnh và trạng thái mic). Cài lần đầu
(chi tiết, kể cả lấy mật khẩu `agent` và huấn luyện model: **`pc-agent/README.md`**):

```powershell
powershell -ExecutionPolicy Bypass -File pc-agent\install-windows.ps1       # cài, chạy ẩn và tự chạy khi đăng nhập
```

Nói "**Hey Vegas**", đợi tiếng bíp, nói "phòng mấy độ". `Ctrl+Alt+M` đóng mic thật (màn hình hiện **MIC OFF**), bấm lần nữa để
mở. Log ở `pc-agent\agent.log`. Chạy tay để xem log trực tiếp: `pc-agent\.venv\Scripts\python pc-agent\main.py`. Cấu hình và cách
huấn luyện model: **`pc-agent/README.md`**.

### Camera: "Trên bàn có gì?" (M7)

Hỏi "**trên bàn có gì?**" (gõ, bấm mic, hoặc "Hey Vegas, …") thì bộ não chụp **một** ảnh từ camera USB trên Pi (qua `vega-vision`), gửi
cho model thị giác (`LLM_VISION`), rồi màn **Vision** hiện chính ảnh đó với khung và nhãn từng vật; VEGAS đọc một câu tóm tắt. Câu kiểu
"cái cốc trên bàn màu gì?" thì AI tự chụp và trả lời. Rút camera: header hiện **CAM OFF**, hỏi thì VEGAS nói "Camera đang rút".

- **Trên PC** (`npm run vega`): camera giả lập (ảnh mặt bàn mẫu `brain/fixtures/desk.jpg`) và model giả `mock`, không tốn tiền. Muốn
  thử model thật trên PC: `LLM_VISION=<provider>` trong `.env`.
- **Trên Pi:** thêm vào `infra/pi/brain.env` một provider nhận ảnh (khối `LLM_<TÊN>_*`) và `LLM_VISION=<tên>`. Camera mặc định
  `/dev/video0`, tối đa `VISION_MAX_DAY=50` ảnh/ngày.
- Ảnh chỉ nằm trong RAM của bộ não 2 phút, không ghi xuống đĩa, không đi qua MQTT (`docs/security.md`, mục 9).

### Camera trực tiếp: "Xem camera" (M7.1)

Nói hoặc gõ "**xem camera**" (hay "camera trực tiếp", "show the camera"), hoặc bấm **Xem trực tiếp** dưới một ảnh: màn **Vision**
chạy video thật từ camera, khung và nhãn tiếng Việt bám theo đồ vật, header ghi `LIVE · YOLO · N FPS`. Nhận diện chạy **ngay trên Pi**
(YOLOX-Nano, ONNX, khoảng 4 lần/giây trên 2 lõi): miễn phí, không cần mạng, video không rời nhà. YOLO chỉ biết 80 loại đồ thông dụng
(cốc, bàn phím, chuột, điện thoại, laptop…); đồ điện tử như ESP8266 chỉ có tên khi hỏi "trên bàn có gì?" (model cloud).

- Dịch vụ `vega-vision` (Python, `vision/`) là tiến trình duy nhất mở camera. Camera chỉ chạy khi có người xem: rời màn Vision thì 10
  giây sau tắt; mỗi phiên tối đa 15 phút rồi hiện **Tiếp tục xem**.
- Chỉnh trong `infra/pi/.env`: `CAMERA_SIZE` (mặc định `1280x720`), `LIVE_FPS` (10), `DETECT_HZ` (4), `LIVE_MAX_MIN` (15).
- **Trên PC** (`npm run vega`): một server giả phát ảnh mẫu kèm vài khung di chuyển, để thử màn hình.

### Backup, giám sát, Console, vị trí điện thoại (M8)

| Gõ hoặc mở | Kết quả |
|---|---|
| `/console` (trên Pi), `http://localhost:5173/console.html` (`npm run vega`) | **Console**: Hôm nay (Pi, AI, thiết bị, lời nhắc, bạn ở nhà hay không, backup, đĩa, container), Thiết bị (bật/tắt), Lời nhắc (huỷ), Nhật ký lệnh, Chi phí 30 ngày, Quyền |
| `tôi đang ở đâu`, `điện thoại ở đâu`, `where am i` | màn **Locate**: bản đồ OpenStreetMap quanh điện thoại, độ chính xác, khoảng cách tới nhà. Câu trả lời không đọc toạ độ |
| `/status` | thêm container, % đĩa trống, backup lần cuối, ở nhà hay vắng nhà |

- **Backup mỗi đêm 03:30** (`infra/pi/backup.sh`, timer `vega-backup`): `brain.db`, `.env`, `brain.env`, `mosquitto/passwd`, mã hoá
  bằng `age`. Giữ 14 bản trên Pi, một bản lên Google Drive nếu đặt `RCLONE_REMOTE`. Dựng lại: `sudo ./infra/pi/setup.sh --restore <file>`
  (`docs/pi-setup.md`, mục "Dựng lại từ đầu").
- **Giám sát** (`infra/pi/health.sh` mỗi phút): container chết, khởi động lại ≥ 3 lần trong 10 phút, đĩa còn < 10%, Pi ≥ 80 °C trong 2
  phút, backup quá 36 giờ: mỗi việc hiện **Alert** một lần, `/status` và Console liệt kê.
- **Điện thoại**: mở VEGAS trên điện thoại và cho phép Vị trí là đủ: trang đang mở thì gửi vị trí trình duyệt (`POST /api/location`).
  Muốn theo dõi cả khi không mở trang: app OwnTracks qua Tailscale tới Mosquitto (user `phone`). Bộ não chỉ giữ điểm mới nhất. Ra khỏi
  nhà thì header hiện **AWAY**.
- **Cài lên màn hình chính** điện thoại: mở trang qua HTTPS (Tailscale) → *Thêm vào màn hình chính*. Mất mạng vẫn mở được, header hiện
  OFFLINE.
- Trên PC (`npm run vega`): điện thoại giả đi bộ quanh nhà (ra khỏi nhà rồi về), Console dùng dữ liệu của bộ não dev, không có giám sát
  (chỉ chạy trên Pi, `HEALTH_WATCH=1`).

### Người gác Pi 3 và thông báo điện thoại (M10)

Một Pi 3 rảnh đứng ngoài trông Pi 4 và chạy **ntfy** (brief 0014). Cài: `docs/pi-setup.md`, mục "Pi 3".

- Pi 4 mất liên lạc quá 3 phút (mất điện, treo, rớt mạng, MQTT chết) thì iPhone nhận **một** tin khẩn có ghi nguyên nhân, lên lại thì có
  tin "đã trở lại" (`infra/pi3/vega-watch.sh`, mỗi phút).
- Bộ não đẩy Alert lên điện thoại: lỗi sức khoẻ của Pi luôn gửi; CI hỏng và lời nhắc chỉ gửi khi bạn **vắng nhà**; Briefing gửi nhẹ một
  dòng. Không cấu hình `NTFY_URL` thì tắt (PC, CI).
- Pi 3 im quá 5 phút thì màn VEGAS hiện Alert, Console › Hôm nay có ô **Pi 3 watchdog**.

### Trí nhớ, giữ bí mật với AI trên cloud (M9)

| Nói | Kết quả |
|---|---|
| `nhớ là tôi dậy lúc 6 giờ`, `remember that I like warm light` | Đã nhớ, không gọi AI. Khởi động lại vẫn nhớ |
| `nhớ bí mật là …` | Nhớ ở mức **riêng tư**: không bao giờ gửi cho AI |
| `nhớ mãi là hôm nay tôi tốt nghiệp` | Chuyện đã xảy ra bình thường tự quên sau 30 ngày; "nhớ mãi" thì giữ |
| `tôi dậy mấy giờ?`, `bạn nhớ gì về tôi` | Trả lời từ trí nhớ, không gọi AI |
| `quên mục 3`; `quên chuyện …`, `quên hết` (cần xác nhận) | Xoá |
| `bật đèn phòng khách` rồi `tắt nó đi`, `bật luôn`, `phòng đó mấy độ` | Hiểu theo câu vừa nói (10 phút), không gọi AI |

- Mật khẩu, OTP, số thẻ, số tài khoản, số giấy tờ: VEGAS từ chối nhớ.
- Khi phải hỏi AI: chỉ kèm tối đa 5 mục *thường* liên quan; tên người và nơi chốn đã dạy đi dưới dạng `Người A`, `Nơi B`. AI có thể đề xuất
  nhớ một sở thích, bạn bấm Confirm mới lưu (`MEMORY_SUGGEST=0` để tắt).
- Console › **Memory**: xem, đổi mức, xoá, và xem mục nào đã gửi AI bao nhiêu lần. Chi tiết: `docs/security.md` §10b, brief 0015.

### Chỉ màn hình, không broker

```bash
npm run dev          # http://localhost:5173, chế độ SIM: dữ liệu giả lập ngay trong trình duyệt, không có bộ não
```

Header hiện trạng thái kết nối: `SIM` (không có broker), `LIVE`, `RECONNECTING`, `OFFLINE`. `#hash` (ví dụ `/#briefing`) vẫn
chuyển cảnh bằng tay để xem thử các màn; trên giao diện không còn nút chọn cảnh, vì bộ não quyết định cảnh.

### Với broker MQTT

```bash
npm run broker                       # broker dev trong tiến trình: mqtt://localhost:1883, ws://localhost:9001 (không mật khẩu!)
#   hoặc: docker compose -f infra/docker-compose.dev.yml up      (Mosquitto, cùng cổng)
npm run sim                          # thiết bị ảo: môi trường, CO₂ theo giờ, radar, 2 relay, Pi stats, CI
VITE_DATA_SOURCE=mqtt npm run dev    # hoặc mở http://localhost:5173/?source=mqtt
```

### Bộ não

```bash
npm run broker                       # cửa sổ 1
npm run sim                          # cửa sổ 2: thiết bị ảo
LLM_ROUTER=mock npm run brain        # cửa sổ 3: bộ não (mock = AI giả chạy offline; none = chỉ lệnh cục bộ)
VITE_DATA_SOURCE=mqtt npm run dev    # cửa sổ 4: gõ lệnh trên thanh lệnh
```

Gõ `phòng mấy độ, bật đèn giúp`: màn Think hiện các bước thật, câu trả lời (nhiệt độ của sim, đèn bật) hiện ở dòng chữ của
Idle, đèn ảo trong sim bật. Lệnh này do **bộ định tuyến cục bộ** xử lý: không gọi AI, chạy cả khi mất mạng.

| Lệnh | Đi đường nào |
|---|---|
| bật/tắt thiết bị, mấy độ, độ ẩm, CO₂, đi ngủ, tập trung, có thiết bị nào (Việt/Anh) | cục bộ, 0 đồng |
| cùng những việc đó nhưng nói khác hoặc STT nghe sai (`cho đèn sáng lên`, `phòng mỹ độ`, `trời tối rồi, bật đèn lên`) | cục bộ theo nghĩa (M11, `brain/src/intent.ts`), 0 đồng |
| câu khác (`có nên mặc áo khoác không`, `kể chuyện cười`) | LLM có tool calling (`LLM_ROUTER`) |
| thiết bị khai `risk: high` (ổ cắm bếp trong sim) | màn `alert` hỏi xác nhận, gõ `yes` trong 30 giây |

Cấu hình (biến môi trường hoặc `.env` ở thư mục chạy): `MQTT_URL`, `VEGA_ROOM`, `BRAIN_DB`, `LLM_ROUTER`/`LLM_CHAT`, khối
`LLM_<NAME>_*` cho từng nhà cung cấp, `BUDGET_USD_DAY`, `RATE_LIMIT_PER_MIN`. Danh sách đầy đủ: `infra/pi/brain.env.example`.
Bảo mật lệnh: `docs/security.md`.

**Chọn nhà cung cấp AI**: điền 2–3 khối `LLM_<NAME>_*` (key, model, giá) vào `.env` rồi chạy `npm run bench`. Bench gửi 50 lệnh
tiếng Việt mẫu (`brain/bench/cases.jsonl`) thẳng tới từng nhà cung cấp và in bảng độ đúng, độ trễ p50, USD/100 lệnh.
`npm run bench -- --provider mock --verbose` chạy không cần key (CI dùng cách này). `npm run bench -- --local` đo hai tầng không
tốn AI trên cùng 50 lệnh: bao nhiêu lệnh làm đúng, bao nhiêu lệnh sai (phải là 0), bao nhiêu để lại cho LLM.

### Bắn cảnh bằng tay

Bắn một cảnh cho mọi màn đang mở:

```bash
npm run scene -- research tools/sim/examples/research.json
npm run scene -- briefing                      # dùng tools/sim/examples/briefing.json
npm run scene -- alert --ttl 20                # hết ttl thì về idle
npm run scene -- research bad.json --raw       # gửi nguyên văn một file sai để thử: các màn sẽ bỏ qua
```

Trong cửa sổ `npm run sim`, gõ `fail` hoặc `pass` để phát sự kiện CI (sim bắn cảnh `alert` / `success`),
`kill bedroom/env` để một thiết bị mất kết nối (Last Will `offline`, mesh giảm ngay), `revive bedroom/env` để bật lại.

Trỏ vào broker của Pi: `MQTT_URL=mqtt://pi.local:1883 MQTT_USER=brain MQTT_PASS=… npm run scene -- briefing`
(hoặc các cờ `--url`, `--user`, `--pass`).

### Ba mức chất lượng

Mặc định `full`. Nút `QUALITY` trên header chuyển `full` ↔ `lite` và nhớ bằng `localStorage` (đổi tay sẽ tải lại trang). `css` chỉ dùng khi gọi rõ `?quality=css` (kiosk Pi).

| Mức | Khác biệt |
|---|---|
| `full` | đúng template: bloom, ~6.500 hạt, mưa ký tự, scanline |
| `lite` | không bloom, ~1.500 hạt, pixel ratio 1, tắt mưa ký tự và scanline |
| `css` | **không tạo WebGL context**; quả cầu dựng bằng CSS/SVG |

Tự hạ cấp khi không chọn tay: `full` dưới 30 FPS trong 3 giây → `lite` (không bao giờ tự rơi xuống `css`); không có WebGL → `css`;
`prefers-reduced-motion` → `css` và tắt animation.

## Kiểm tra

```bash
npm run lint && npm run check && npm test      # lint, TypeScript strict (+ checkJs cho JS của template), unit test (cả brain)
python -m unittest discover voice              # vega-voice (không cần Piper: giọng giả)
python -m unittest discover pc-agent           # pc-agent (không cần mic: âm thanh giả)
PC_AGENT_PYTHON=<python có requirements của pc-agent> npm test   # thêm test tích hợp pc-agent đọc file WAV
npm run build && npm run size                  # build và ngân sách JS ≤ 300 KB gzip
npm run build -w brain                         # bundle bộ não (brain/dist/brain.mjs, chỉ cần Node để chạy)
npm run bench -- --provider mock               # bảng bench với AI giả
npm run test:e2e                               # Playwright + broker, sim, brain trong tiến trình (cần: npx playwright install chromium;
                                               # Chromium ở chỗ khác thì đặt CHROMIUM_PATH)
SHOTS=1 npm run test:e2e                       # chụp ảnh vào docs/screenshots/m0
npm run compare                                # ảnh cạnh nhau với template gốc (docs/screenshots/m0/compare)
```

## Triển khai

- Chỉ dashboard, chế độ SIM: `docker compose -f infra/docker-compose.yml up --build` → http://localhost:8080
- Raspberry Pi 4 (Mosquitto có mật khẩu và ACL, `vega-brain`, dashboard, kiosk Chromium ở mức `css`): xem **`docs/pi-setup.md`**.
  Ảnh `vega-brain` build được cho cả amd64 và arm64: `docker buildx build --platform linux/arm64 -f brain/Dockerfile .`
- Dashboard (8080) và WebSocket MQTT (9001) trên Pi chỉ nghe ở `localhost` và địa chỉ Tailscale, không nghe ở LAN.
  HTTPS (để dùng mic) qua `tailscale serve`; trang HTTPS nối MQTT bằng `wss://<cùng host>/mqtt`.

## Tài liệu

- `docs/contract.md`: topic, payload, giao thức cảnh (revision 9)
- `docs/security.md`: bảo mật lệnh (ai được ra lệnh, xác nhận, giới hạn tần suất, prompt injection)
- `docs/pi-setup.md`: cài Pi
- `docs/decisions/0002-vega-product-plan-1.0.md`: phương án sản phẩm 1.0 (9 mốc)
- `docs/decisions/0016-two-tracks-pi3-pi4.md`: chia hai phần, Pi 4 (bộ não) và Pi 3 (hạ tầng), các mốc P3.x (bản nháp)
- `docs/decisions/0015-m9-memory-private.md`: brief M9 (trí nhớ, mức bí mật, bí danh khi gửi AI)
- `docs/decisions/0014-pi3-watch-m10.md`: brief M10 (Pi 3 làm người gác, thông báo điện thoại qua ntfy)
- `docs/decisions/0013-m8-phone-console-ops.md`: brief M8 (backup, giám sát, Console, Locate, PWA)
- `docs/decisions/0012-roadmap-m9-m16.md`: lộ trình sau 1.0 (bản nháp)
- `docs/decisions/0011-m7.1-live-vision.md`: brief M7.1 (camera trực tiếp, YOLO trên Pi)
- `docs/decisions/0010-m7-vision.md`: brief M7 (camera)
- `docs/decisions/0009-m5.2-wake-word.md`: brief M5.2 ("Hey Vegas")
- `docs/decisions/0008-m5-voice.md`: brief M5 (giọng nói)
- `docs/decisions/0004-m1-brain.md`: brief M1
- `docs/decisions/0003-m0-foundation.md`: brief M0
- `docs/decisions/0001-vega-ui-v0.1.md`: *Superseded by 0002/0003*
