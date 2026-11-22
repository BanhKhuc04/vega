# Decision Brief 0012 — Lộ trình sau 1.0: M9–M16, tận dụng tối đa Pi 4

| | |
|---|---|
| **Ngày** | 2026-11-21 |
| **Trạng thái** | Bản nháp, chờ duyệt (bản 2: viết lại sau khi tra benchmark và bài báo cho Pi 4) |
| **Dựa trên** | 0002 (D4 cổng LLM trung lập, D5 định tuyến cục bộ trước, D6 trần chi phí, D7 giọng nói theo tầng, mục 8 bảo mật), 0004 (bench 50 lệnh), 0008 (V4: Whisper trên Pi 4 quá chậm), 0009 (pc-agent viết để chạy được trên Pi), 0011 (Pi 4, onnxruntime, `vega-vision` giữ 2 lõi) |
| **Sửa** | 0002 mục 3.1–3.2 (phần cứng), mốc M2 (cách nối thiết bị), mốc M8 (tách thông báo điện thoại ra M10) |
| **Bị sửa bởi** | 0014 (đã duyệt 2026-11-22): M10 làm trước M9 và chạy trên Pi 3; phần nghe 24/7 của M12, M13 chạy trên Pi 3 |

## 1. Vấn đề

Bảy mốc của 0002 xong trong khoảng 4 ngày. Hiện đã merge M0, M1, M3–M6; M7 có commit nhưng chưa có PR; M7.1 đã duyệt. Còn **M2**
(chờ mua phần cứng) và **M8**.

Đem ra dùng hằng ngày thì thấy những chỗ hụt sau:

- VEGA **không nhớ gì** giữa các câu. "Bật đèn" rồi "tắt nó đi" là VEGA không hiểu.
- Bộ định tuyến cục bộ chỉ khớp mẫu. Nói khác mẫu một chút (hoặc STT nghe sai, như "Phòng mấy độ" thành "Phòng Mỹ đụng", 0009 câu
  hỏi mở 4) là phải gọi AI, mất tiền, và mất mạng thì không làm được gì.
- **Wake word và mic chỉ có trên PC.** PC tắt (đa số thời gian, theo 0002) thì không gọi VEGA bằng giọng được. STT luôn cần internet.
- Lịch, Gmail, GitHub chỉ được đọc. Thông báo chỉ hiện trên màn ở bàn.

0002 viết cho **Pi 3, 1 GB**. Máy thật là **Pi 4** (4 lõi Cortex-A72, còn khoảng 3 GB RAM trống, 0011), không có NPU. Câu hỏi của
brief này: **Pi 4 thực sự làm tốt được những gì**, và đem phần nào ra khỏi Pi.

## 2. Pi 4 làm được gì: số liệu tra được

Các con số dưới đây lấy từ bài báo, tài liệu của dự án và blog. **Chưa đo trên Pi của VEGA.** Cột cuối là kết luận cho VEGA.

| Việc | Số liệu tìm được | Kết luận |
|---|---|---|
| LLM ≥ 1B trên Pi 4 | Bài đánh giá 25 model trên máy tính bo mạch đơn: model ≥ 1B "thường dưới 5 token/giây" trên Pi 4, chỉ model ≤ 135M mới vượt 15 token/giây ([arXiv 2511.07425](https://arxiv.org/html/2511.07425v1)). Qwen2.5 1.5B Q4 chỉ khoảng 10 token/giây trên **Pi 5** ([PocketClaw](https://pocketclaw.dev/guides/local-llms-benchmark-2026)) | ❌ **Không chạy LLM trên Pi.** Chat trên Pi sẽ mất 20–60 giây mỗi câu. LLM cục bộ chỉ chạy trên PC |
| Gọi tool bằng model nhỏ | 0,5B đúng khoảng 70%, 3B khoảng 83%, 7B trở lên trên 90% ([tài liệu ppxai](https://rcconsult.github.io/ppxai/1.17.3/ollama-limitations), đo trên GPU). Có benchmark riêng cho gọi tool của model dưới 2B chạy CPU ([arXiv 2609.07370](https://arxiv.org/pdf/2609.07370)) | ❌ Model vừa sức Pi không đủ tin cậy để điều khiển thiết bị. Trên Pi thì dùng **bộ phân loại**, không dùng model sinh chữ |
| Wake word (openWakeWord) | Một lõi Pi **3** chạy 15–20 model cùng lúc theo thời gian thực ([README openWakeWord](https://raw.githubusercontent.com/dscripka/openWakeWord/HEAD/README.md)). Pi 4 chạy được 5 vệ tinh giọng nói cùng lúc ([Home Assistant](https://home-assistant.io/voice_control/about_wake_word)) | ✅ **Rất dư sức.** Wake word nên chạy 24/7 trên Pi chứ không chỉ trên PC |
| Nhận giọng chủ nhân (speaker verification) | Model nhỏ chạy trên Pi **3B** với độ trễ dưới 200 ms cho câu 5 giây ([Sonos, arXiv 2011.01709](https://arxiv.org/pdf/2011.01709)). sherpa-onnx hỗ trợ 3D-Speaker (CAM++, ERes2Net) trên Raspberry Pi ([3D-Speaker, arXiv 2403.19971](https://arxiv.org/pdf/2403.19971)) | ✅ Chạy tốt, nên làm |
| Phân loại âm thanh (CED, AudioSet 527 lớp) | CED-tiny có 5,5M tham số, file int8 6 MB, sherpa-onnx có sẵn API audio tagging trên Pi ([model](https://huggingface.co/k2-fsa/sherpa-onnx-ced-tiny-audio-tagging-2024-04-19/tree/main), [arXiv 2509.14049](https://arxiv.org/abs/2509.14049v2)) | ✅ Rất nhẹ. Nghe được chuông cửa, báo khói, kính vỡ… mà không gửi âm thanh ra ngoài |
| Hiểu ý câu bằng embedding (semantic router) | Model2Vec (chưng cất từ LaBSE, có bản đa ngôn ngữ) được OpenVoiceOS dùng để phân loại ý trên Raspberry Pi ([OVOS](https://openvoiceos.github.io/ovos-technical-manual/m2v_pipeline)). Router dùng encoder lượng tử hoá: P99 khoảng 4 ms trên 2 lõi CPU cloud ([SynaptoRoute](https://dev.to/sitanshukr08/synaptoroute-a-study-in-local-semantic-routing-2mid)). multilingual-e5-small chạy được nhưng chậm hơn nhiều ([Bekko](https://huggingface.co/blog/hotchpotch/bekko-embedding)) | ✅ **Ý tưởng đáng giá nhất cho Pi:** hiểu được câu nói khác mẫu, chạy offline, vài ms, 0 đồng |
| STT tiếng Việt offline (Zipformer-vi, sherpa-onnx) | Bản int8 khoảng 75 MB. Benchmark công bố đo trên Apple M2 Pro, **không có số cho Pi 4** ([phostt](https://docs.rs/crate/phostt/0.4.3), [viet-asr](https://huggingface.co/coflar-ai/viet-asr)). Zipformer streaming có RTF khoảng 0,06–0,13 trên máy không rõ cấu hình ([sherpa-onnx](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)) | ⚠️ **Nhiều khả năng đủ cho câu lệnh ngắn**, nhưng phải đo trước. Whisper trên Pi 4 thì đã bị loại ở 0008 |
| YOLO trên Pi 4 (M7.1) | YOLO11n ONNX 640 px: 6,8 fps trên **Pi 5**. Ultralytics khuyên dùng NCNN cho Pi ([Ultralytics](https://docs.ultralytics.com/guides/raspberry-pi)). Pi 4 ước khoảng 2–3 fps ở 640 px (blog, không ghi cách đo) | ⚠️ Mục tiêu 2–4 lần/giây ở 416 px của 0011 là vừa sức, không dư. Nên thử NCNN trước ONNX |
| Piper giọng medium trên Pi 4 | RTF khoảng 1–2, tức 1–3 giây cho một câu ngắn (blog, [pyshine](https://pyshine.com/piper/)). Trên Pi 5 RTF khoảng 0,19 | ⚠️ Đang dùng được (M5) nhưng có độ trễ. Cần đo trên máy thật và đọc từng câu một |
| Zigbee2MQTT, ntfy | Zigbee2MQTT là cầu nối nhẹ, chạy phổ biến trên Pi ([so sánh](https://selfhosting.sh/compare/esphome-vs-zigbee2mqtt/)). ntfy tốn khoảng 30–50 MB RAM, có bản ARM64 ([pimylifeup](https://pimylifeup.com/raspberry-pi-ntfy/)) | ✅ Nhẹ |
| Bộ tăng tốc USB cho Pi 4 | Coral USB: có nơi bán đã ngừng, có nơi còn hàng. Frigate đề xuất thôi khuyên dùng vì thư viện phụ thuộc bị bỏ ([issue](https://github.com/blakeblackshear/frigate/issues/10056)). Hailo chỉ có cho Pi 5 | ❌ **Không mua.** Muốn nhanh hơn thì lên Pi 5 + Hailo, ngoài phạm vi brief này |

**Tóm lại:** thế mạnh của Pi 4 là **model nhỏ chạy liên tục**: wake word, VAD, nhận giọng, phân loại âm thanh, embedding (từ vài MB tới
vài chục MB, từ vài ms tới vài trăm ms). Pi 4 **yếu** ở model sinh chữ và ảnh lớn. Vì vậy chia việc như sau: Pi nghe, phân loại, quyết
định và chạy luật; PC (khi bật) hoặc cloud thì suy nghĩ.

## 3. Quyết định

| # | Quyết định |
|---|---|
| R1 | **Cập nhật phần cứng trong 0002:** máy 24/7 là Pi 4. Kiosk trên Pi chạy chế độ `lite`, `full` vẫn chỉ chạy trên PC |
| R2 | **Nợ cũ làm trước:** mở PR cho M7, rồi M7.1, rồi M2 và M8. Chưa có phần cứng cho M2 thì làm M9 và M10 trong lúc chờ |
| R3 | **M2 dùng Zigbee cho thiết bị mua sẵn:** USB coordinator cắm vào Pi, Zigbee2MQTT chạy container, bộ não dịch `zigbee2mqtt/*` sang `vega/*`. ESP chỉ dùng cho thứ phải tự làm (SCD40, LD2410). Brief M2 sẽ chốt chi tiết |
| R4 | **Không chạy model sinh chữ trên Pi.** Trên Pi chỉ chạy model phân loại và embedding dưới khoảng 100 MB. LLM cục bộ chỉ chạy trên PC (M15) |
| R5 | **Ngân sách CPU của Pi 4:** việc chạy liên tục (wake word, VAD, phân loại âm thanh, Mosquitto, bộ não, Zigbee2MQTT) tổng cộng **không quá 1 lõi**. Việc chạy theo đợt (STT, TTS, nhận giọng) dùng lõi còn lại. `vega-vision` giữ tối đa 2 lõi (0011) và **tự hạ `DETECT_HZ` khi STT hoặc TTS đang chạy**, để giọng nói luôn được ưu tiên hơn video |
| R6 | **Mốc nào dùng model mới thì mở đầu bằng một lần đo trên Pi 4 thật** (độ trễ, % CPU, RAM, độ chính xác trên dữ liệu tiếng Việt của chính VEGA). Số liệu ghi vào brief của mốc đó. Không đạt thì dùng phương án lùi ở mục 6 |
| R7 | **Riêng tư:** mọi model nghe trên Pi xử lý âm thanh trong RAM, không ghi đĩa, không gửi đi. Chỉ chữ (sau wake word) hoặc tên sự kiện ("doorbell") được rời khỏi bộ xử lý. Công tắc mic vật lý (D9) tắt được tất cả. Màn hình luôn hiện mic đang làm gì (`MIC: WAKE`, `MIC: EVENTS`, `MIC OFF`) |
| R8 | **Mỗi mốc có brief riêng** (0013 trở đi) với scope và Definition of Done chi tiết. Brief này chỉ chốt danh sách, thứ tự, nơi chạy và tiêu chí "Xong khi" |

## 4. Các mốc mới (số mốc cũng là thứ tự làm)

| Mốc | Chạy ở | Nội dung | Xong khi |
|---|---|---|---|
| **M9 · Trí nhớ** (1 tuần) | Pi (SQLite) + LLM đang dùng | **Ngắn hạn:** giữ khoảng 6 lượt gần nhất mỗi phiên, bộ định tuyến cục bộ hiểu "nó", "cái đó" là thiết bị vừa nhắc. **Dài hạn:** bảng `memory` trong SQLite. "Nhớ là…" để ghi, "bạn nhớ gì về tôi" để xem, "quên…" để xoá. Mỗi lần gọi LLM chỉ kèm những mục liên quan (tìm bằng embedding của M11 khi có, trước đó tìm theo từ khoá), có trần token | "Bật đèn" rồi "tắt nó đi" chạy đúng mà không gọi AI. "Tôi dậy mấy giờ" trả lời đúng điều đã dặn, khởi động lại vẫn nhớ |
| **M10 · Thông báo điện thoại** (vài ngày) | Pi (0014: ntfy trên Pi 3, kèm người gác Pi 4) | Container **ntfy** (khoảng 30–50 MB), chỉ vào được qua Tailscale, có mật khẩu. Đẩy Alert, lời nhắc, Briefing tóm tắt. Màn ở bàn đang mở thì không đẩy trùng. Telegram là kênh dự phòng (tuỳ chọn, khoá theo chat ID) | Đang ở ngoài, build hỏng thì điện thoại báo trong vòng 2 phút. Tới giờ nhắc thì điện thoại kêu |
| **M11 · Hiểu lệnh bằng embedding** (1 tuần) | Pi | Thêm một tầng giữa khớp mẫu và LLM (D5): mỗi ý định (bật/tắt thiết bị, hỏi nhiệt độ, lịch, CI, nhắc việc…) có 10–30 câu mẫu tiếng Việt và tiếng Anh. Câu mới được embed bằng model nhỏ (ứng viên: Model2Vec đa ngôn ngữ, so với multilingual-e5-small) rồi chọn ý gần nhất. Vượt ngưỡng thì làm luôn, dưới ngưỡng thì gọi LLM như cũ. Tham số (phòng, giờ, thiết bị) vẫn lấy bằng bộ phân tích cục bộ có sẵn. Bench 50 lệnh của 0004 thêm cột "đúng mà không tốn AI" | Trên bench, số lệnh làm đúng mà **không gọi AI** tăng rõ so với chỉ khớp mẫu (mục tiêu ≥ 80%) và không làm sai lệnh thiết bị nào. Câu STT nghe hơi sai ("phòng mỹ độ") vẫn hiểu. Mỗi câu dưới 50 ms trên Pi 4 |
| **M12 · Giọng nói 24/7 trên Pi** (2 tuần) | Pi + mic USB ở bàn (0014: wake word, VAD, nhận giọng trên Pi 3; STT trên Pi 4) | Chạy `pc-agent` trên Pi (0009 đã viết để chạy được, đây là M5.3 cũ): **wake word** openWakeWord + **VAD** cắt câu + **STT tiếng Việt offline** (Zipformer-vi int8 qua sherpa-onnx; Groq làm dự phòng khi độ tin cậy thấp hoặc câu dài) + **nhận giọng chủ nhân** (3D-Speaker qua sherpa-onnx, đăng ký giọng bằng khoảng 10 câu). Lệnh vật lý và lệnh cần xác nhận chỉ chạy khi giọng khớp chủ. Giọng lạ chỉ được hỏi giờ, thời tiết. Piper đọc từng câu một để câu đầu ra tiếng sớm | PC tắt, rút dây internet, nói "Hey Vega, bật đèn" thì đèn bật. Từ lúc nói xong đến lúc có hành động dưới 2,5 giây. Phát giọng người khác qua loa (hoặc giọng Piper) thì lệnh vật lý bị từ chối. Wake word cộng VAD chạy liên tục dưới 15% của một lõi |
| **M13 · Nghe sự kiện âm thanh** (1 tuần) | Pi, dùng chung mic với M12 (0014: trên Pi 3) | CED-tiny (6 MB, int8) phân loại âm thanh mỗi khoảng 1 giây, chỉ theo dõi một danh sách lớp ngắn: báo khói hoặc báo cháy, chuông cửa, gõ cửa, kính vỡ, nước chảy lâu, còi xe ngay trước nhà. Phải nghe thấy nhiều khung liên tiếp mới tính là sự kiện. Có sự kiện thì hiện màn Alert, đẩy ntfy (M10) và ghi nhật ký. **Tắt mặc định**, bật bằng lệnh hoặc theo luật ("khi tôi ra khỏi nhà") | Phát mẫu âm báo khói và chuông cửa (bộ thử thu sẵn) thì có Alert trong 5 giây. Một tuần bật liên tục có không quá 1 báo nhầm mỗi ngày. Không có file âm thanh nào nằm trên đĩa |
| **M14 · Hành động ghi** (1–2 tuần) | Pi | Thêm hoặc dời sự kiện lịch (scope `calendar.events`), chạy lại workflow GitHub (Actions write, chỉ cho repo đã khai), tắt, khoá, ngủ PC qua `pc-agent`. Mọi hành động đều qua thẻ **Confirm / Cancel** và nhận giọng chủ (M12) khi ra lệnh bằng giọng. Gmail vẫn chỉ đọc. Nội dung ngoài vẫn không kích hoạt được hành động | "Thêm lịch họp 3h chiều mai" → thẻ xác nhận → sự kiện có trên Google Calendar. Tiêu đề mail ghi "xoá lịch ngày mai" không làm được gì |
| **M15 · AI cục bộ trên PC** (1 tuần) | **PC**, không phải Pi | Provider **Ollama** (OpenAI-compatible, D4) trỏ vào PC, ứng viên Qwen 3–4B Q4, chọn bằng bench 0004. PC đang bật thì việc `chat` nhẹ chạy ở PC. Hết trần ngày hoặc mất internet thì chuyển sang PC thay vì chỉ còn lệnh cục bộ. PC tắt thì quay về cloud hoặc cục bộ, không bật PC chỉ để trả lời một câu | Bench cho thấy model cục bộ gọi tool đúng ≥ 85%. Đã hết `BUDGET_USD_DAY` mà PC bật thì VEGA vẫn trả lời được. Header có chip `LOCAL AI` |
| **M16 · Tự động hoá chủ động** (2 tuần, cần M2) | Pi | **Gợi ý luật:** mỗi tuần xét nhật ký lệnh, tìm việc lặp lại (cùng lệnh, cùng khung giờ, ≥ 4 lần mỗi tuần), mỗi lần gợi ý **tối đa một luật** (Create / Not now / Never), luật ghi bằng YAML của M2. **Có mặt hay vắng nhà:** Bluetooth sẵn trên Pi 4 dò điện thoại (BLE) kết hợp radar LD2410 và OwnTracks (M8). **Bất thường cảm biến:** CO₂, nhiệt độ, nhiệt độ Pi, mất kết nối thiết bị lệch khỏi mức thường ngày (trung bình trượt, không cần ML). Vắng nhà thì tự bật M13 | Có ít nhất một luật do VEGA gợi ý được duyệt và chạy đúng một tuần. "Never" thì không gợi ý lại. Ra khỏi nhà 10 phút thì VEGA chuyển sang chế độ vắng nhà. Không luật nào được tạo nếu chủ chưa bấm |

## 5. Ngoài phạm vi

- LLM, VLM hay Whisper chạy trên Pi 4 (mục 2: quá chậm).
- Mua Coral USB.
- Nâng lên Pi 5 + Hailo: nếu cần sẽ có brief riêng.
- Nhận diện khuôn mặt hay người cụ thể qua camera.
- Ghi âm hoặc ghi hình liên tục.
- Gửi mail thay chủ.
- Nhiều người dùng: M12 chỉ phân biệt chủ và người lạ.
- Mở cổng ra internet.
- Huấn luyện lại STT.
- App điện thoại riêng.

## 6. Rủi ro và phương án lùi

1. **Zipformer-vi trên Pi 4 chưa có số đo.** Nếu một câu lệnh 3 giây mất hơn 1,5 giây để nhận dạng, hoặc tỉ lệ lỗi từ trên 50 câu của
   chủ tệ hơn Groq quá 10 điểm, thì Pi chỉ làm wake word, VAD và nhận giọng, còn STT dùng Groq (có mạng) hoặc PC (khi bật).
2. **Model2Vec đa ngôn ngữ có thể yếu với tiếng Việt.** So với multilingual-e5-small trên cùng bench. Cả hai đều không đạt thì giữ khớp
   mẫu và thêm câu mẫu, M11 thu gọn lại thành sửa lỗi STT bằng so khớp gần đúng.
3. **Nhận giọng sai với mic rẻ hoặc phòng vang.** Ngưỡng chỉnh theo dữ liệu thật. Lùi về Confirm/Cancel trên màn cho lệnh vật lý, không
   chặn hẳn.
4. **CED-tiny báo nhầm** (TV, nhạc). Cần nhiều khung liên tiếp, chỉ theo dõi danh sách lớp ngắn, và có thể chỉ bật khi vắng nhà.
5. **Tranh CPU khi đang xem camera** (M7.1 chiếm 2 lõi). R5 ưu tiên giọng nói. Đo tổng % CPU và nhiệt độ khi mọi thứ cùng chạy. Pi 4
   cần tản nhiệt chủ động.
6. **Piper medium có độ trễ 1–3 giây mỗi câu.** Đọc từng câu một. Nếu vẫn chậm, thử giọng `low` hoặc dùng giọng cloud cho câu dài.
7. **ntfy trên iOS:** có báo cáo mất âm thanh từ iOS 26.2. Nếu đúng thì Telegram thành kênh chính cho iPhone.
8. **M9 và M14 mở rộng token và quyền.** Có trần token cho ngữ cảnh, và `docs/security.md` phải được cập nhật trước khi bật M14.

## 7. Việc chủ dự án cần quyết hoặc chuẩn bị

1. **Duyệt brief này**, hoặc ghi chỗ muốn sửa.
2. Đồng ý **M2 bằng Zigbee** (R3). Nếu đồng ý thì mua USB coordinator Zigbee và ổ cắm, cảm biến Zigbee.
3. **Mic USB có công tắc** cho bàn (đã có trong danh sách mua của 0002), cần cho M12 và M13. Tản nhiệt chủ động cho Pi 4 nếu chưa có.
4. Điện thoại chính là **Android hay iPhone** (M10).
5. Thu sẵn **khoảng 50 câu lệnh bằng giọng mình** qua chính mic sẽ dùng: dùng để đo M11 và M12 và để đăng ký giọng.

Khi brief được duyệt, bước kế tiếp là mở PR cho M7, rồi làm M7.1 theo 0011 (thêm R5: nhường CPU cho giọng nói).
