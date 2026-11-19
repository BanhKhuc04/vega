# VEGA

Trợ lý cá nhân chạy 24/7 trên Raspberry Pi 3, có màn hình FUI ở bàn và trên PC. Bản này là **M1 · Bộ não v1**
(trên nền **M0 · Nền móng**): `vega-brain` nhận lệnh từ thanh lệnh, hiểu lệnh (cục bộ trước, AI sau), gọi tool thiết bị và điều
khiển màn hình qua `vega/ui/scene`. Chưa có giọng nói, Telegram, Google, GitHub, phần cứng thật
(xem `docs/decisions/0002-vega-product-plan-1.0.md`, `0004-m1-brain.md`).

> Chữ trên giao diện giữ tiếng Anh như template; tài liệu và ghi chú dự án bằng tiếng Việt.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `packages/contract` | topic MQTT, schema payload (zod) và **giao thức cảnh** `vega/ui/scene` cho 11 template. Nơi duy nhất định nghĩa hợp đồng |
| `dashboard` | màn VEGA Core (template `design/final:vega/`: Three.js + GSAP), lớp dữ liệu, bộ vẽ cảnh |
| `tools/sim` | thiết bị ảo, `npm run scene`, broker MQTT chạy trong tiến trình (không cần Docker) |
| `infra` | compose cho dev và cho Pi (Mosquitto có mật khẩu + ACL, nginx), `setup.sh` |
| `brain` | `vega-brain` (Node 22, TypeScript): sổ thiết bị, định tuyến cục bộ, cổng LLM + provider `mock`, SQLite (nhật ký lệnh, sổ chi phí), bảo mật lệnh, bench chọn nhà cung cấp AI |
| `pc-agent`, `firmware` | chỗ giữ chỗ cho các mốc sau (M5, M2) |
| `docs` | hợp đồng, hướng dẫn Pi, các Decision Brief |

## Chạy thử (PC)

Cần Node.js 22.

### Dùng VEGA: một lệnh

```bash
npm ci
npm run vega         # broker + thiết bị ảo + bộ não (đọc .env) + màn VEGA, trong một tiến trình. Mở địa chỉ nó in ra
```

Gõ vào ô **Ask VEGA…** rồi Enter, hoặc bấm **mic** để nói (tiếng Việt). Câu hỏi và câu trả lời hiện trong khung trò chuyện
phía trên ô nhập, và VEGA **đọc to** câu trả lời (nút loa để bật/tắt). Hành động cần xác nhận hiện thẻ có nút **Confirm / Cancel**.

| | Yêu cầu |
|---|---|
| Nhắn | trình duyệt nào cũng được |
| Đọc to | giọng có sẵn của máy. Câu tiếng Việt cần giọng tiếng Việt: Microsoft Edge có sẵn, hoặc thêm trong Windows Settings › Time & language › Speech. Không có giọng hợp thì VEGA im lặng và báo trong khung chat |
| Nói (mic) | Chrome hoặc Edge, có internet. Âm thanh do Google/Microsoft nhận dạng (Web Speech API). Chưa chạy trên kiosk Chromium của Pi; giọng nói chạy offline là việc của M5 |

AI dùng nhà cung cấp trong `.env` (`LLM_ROUTER`); không có thì chỉ chạy lệnh cục bộ. VEGA chưa nhớ hội thoại: mỗi câu được xử lý riêng.
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
| Hỏi `sao fail` / `vì sao build lỗi` / `why did it fail` (hoặc bấm Explain) | VEGA đọc khoảng 150 dòng log quanh lỗi và giải thích ngắn gọn. Không có AI thì trả lời bằng bước bị hỏng và dòng lỗi đầu tiên |
| Hỏi `ci thế nào` / `build status` | trạng thái các workflow, chạy cục bộ, 0 đồng |
| Gõ `/status` (hoặc `tình trạng hệ thống`) | Pi (nhiệt độ, CPU, RAM, uptime), thiết bị online, CI, AI budget hôm nay, chạy cục bộ |
| Build xanh lại | màn **Success** |
| GitHub không trả lời quá 5 phút | ô CI/CD ghi thêm `stale`; không bắn Alert giả |

Log và thông điệp commit do người khác viết, nên VEGA coi chúng là dữ liệu ngoài: khi chúng có mặt thì không lệnh vật lý nào
được chạy (`docs/security.md`).

### Trợ lý cá nhân: lịch, mail, thời tiết, nhắc việc, Focus (M4)

| Gõ hoặc nói | Kết quả |
|---|---|
| `hôm nay có lịch gì`, `lịch ngày mai`, `sự kiện tiếp theo`, `what's on today` | lịch Google, trả lời cục bộ (0 đồng) |
| `có mail gì mới không`, `any new mail` | thư **chưa đọc trong Hộp thư chính** 24 giờ qua: người gửi và tiêu đề |
| `thời tiết thế nào`, `có mưa không` | Open-Meteo, theo toạ độ `WEATHER_LAT` / `WEATHER_LON` |
| `briefing`, `tóm tắt hôm nay` | màn **Briefing**: lịch hôm nay, mail, thời tiết, phòng, CI. Tự hiện mỗi ngày lúc `BRIEFING_AT` (mặc định `07:00`) |
| `nhắc tôi 3 giờ chiều gọi mẹ`, `nhắc tôi sau 20 phút uống nước`, `remind me at 5pm to call mom` | tới giờ: thẻ Alert có nút **Snooze 10 min**, và VEGA đọc to. Lời nhắc lưu trong SQLite, khởi động lại không mất |
| `nhắc nhở của tôi`, `huỷ nhắc 2` | xem / huỷ lời nhắc |
| `tập trung 25 phút`, `focus for 1 hour`, `dừng tập trung` | màn **Focus**: build hỏng và lời nhắc chờ tới khi hết giờ rồi mới hiện |

Câu trả lời theo ngôn ngữ của câu hỏi. Briefing tự hiện thì dùng `VEGA_LANG` (mặc định `vi`). Những gì VEGA tự nói (lời nhắc,
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

VEGA chỉ lấy phần đầu thư (`format=metadata`), không bao giờ tải nội dung thư, không gửi mail, không sửa lịch. Tiêu đề lịch và mail
là dữ liệu ngoài: dù có ghi "tắt hết thiết bị" cũng không điều khiển được gì (`docs/security.md`).

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
| câu khác (`ngoài ban công không khí có trong lành không`) | LLM có tool calling (`LLM_ROUTER`) |
| thiết bị khai `risk: high` (ổ cắm bếp trong sim) | màn `alert` hỏi xác nhận, gõ `yes` trong 30 giây |

Cấu hình (biến môi trường hoặc `.env` ở thư mục chạy): `MQTT_URL`, `VEGA_ROOM`, `BRAIN_DB`, `LLM_ROUTER`/`LLM_CHAT`, khối
`LLM_<NAME>_*` cho từng nhà cung cấp, `BUDGET_USD_DAY`, `RATE_LIMIT_PER_MIN`. Danh sách đầy đủ: `infra/pi/brain.env.example`.
Bảo mật lệnh: `docs/security.md`.

**Chọn nhà cung cấp AI**: điền 2–3 khối `LLM_<NAME>_*` (key, model, giá) vào `.env` rồi chạy `npm run bench`. Bench gửi 50 lệnh
tiếng Việt mẫu (`brain/bench/cases.jsonl`) thẳng tới từng nhà cung cấp và in bảng độ đúng, độ trễ p50, USD/100 lệnh.
`npm run bench -- --provider mock --verbose` chạy không cần key (CI dùng cách này).

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
- Raspberry Pi 3 (Mosquitto có mật khẩu và ACL, `vega-brain`, dashboard, kiosk Chromium ở mức `css`): xem **`docs/pi-setup.md`**.
  Ảnh `vega-brain` build được cho cả amd64 và arm64: `docker buildx build --platform linux/arm64 -f brain/Dockerfile .`
- Dashboard (8080) và WebSocket MQTT (9001) trên Pi chỉ nghe ở `localhost` và địa chỉ Tailscale, không nghe ở LAN.

## Tài liệu

- `docs/contract.md`: topic, payload, giao thức cảnh (revision 3)
- `docs/security.md`: bảo mật lệnh (ai được ra lệnh, xác nhận, giới hạn tần suất, prompt injection)
- `docs/pi-setup.md`: cài Pi
- `docs/decisions/0002-vega-product-plan-1.0.md`: phương án sản phẩm 1.0 (9 mốc)
- `docs/decisions/0004-m1-brain.md`: brief M1 (phần này)
- `docs/decisions/0003-m0-foundation.md`: brief M0
- `docs/decisions/0001-vega-ui-v0.1.md`: *Superseded by 0002/0003*
