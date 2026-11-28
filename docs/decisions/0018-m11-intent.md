# Decision Brief 0018: M11 hiểu lệnh nói khác hoặc nghe sai, không cần AI

| | |
|---|---|
| **Ngày** | 2026-11-28 |
| **Trạng thái** | Đã làm (chủ dự án giao làm hết lộ trình, tự merge khi CI xanh) |
| **Dựa trên** | 0012 (M11, R4, R6, rủi ro 2), 0004 (bench 50 lệnh), 0009 (câu hỏi mở 4: STT nghe "phòng mấy độ" thành "phòng mỹ độ"), 0016 (M11 sửa lỗi "đúng chữ, sai việc") |
| **Sửa** | 0012 M11: dùng bộ phân loại n-gram ký tự thay cho model embedding (mục 3) |
| **Nhánh** | `feat/m11-intent`, từ `main` |

## 1. Vấn đề

Bộ định tuyến cục bộ (`brain/src/local.ts`) chỉ nhận lệnh khi **mọi chữ** đều nằm trong bảng mẫu. Cách này an toàn, nhưng nói khác
một chút là phải gọi AI. Đo trên bench 50 lệnh (`npm run bench -- --local`), trước M11:

| | Đúng, không tốn AI | Sai | Để cho AI |
|---|---|---|---|
| Chỉ khớp mẫu | 17/41 lệnh (41%) | 0 | 33 câu |

Các câu bị trượt phần lớn chỉ thừa một chữ: "mở đèn **lên nào**", "tắt ổ cắm **trong** bếp", "**phòng khách tối quá,** bật đèn lên",
"tắt ổ cắm bếp giúp, **sợ cháy**", "nhiệt độ **ngoài** ban công".

## 2. Hai cách đã xét

| | Model embedding (Model2Vec đa ngôn ngữ, multilingual-e5-small) | Bộ phân loại n-gram ký tự (đã chọn) |
|---|---|---|
| File model | Vài chục tới vài trăm MB; container `vega-brain` chỉ có `mem_limit: 160m` | Không có. Khoảng 150 câu mẫu nằm ngay trong mã |
| Hiểu câu đồng nghĩa hoàn toàn khác chữ | Tốt hơn | Chỉ khi gần câu mẫu |
| STT nghe sai một hai chữ ("mỹ độ") | Kém, vì tách từ theo token | Tốt, vì so từng cụm 3 ký tự |
| Đo trên Pi 4 (R6) | Bắt buộc, hiện không có Pi | Không cần model nên không có rủi ro tải hay RAM |

Rủi ro 2 của 0012 đã tính đến việc này: nếu embedding yếu với tiếng Việt thì thu M11 về hướng so khớp gần đúng. Ở đây chọn luôn hướng
đó, vì nó đạt mục tiêu (mục 4) mà không cần model. Khi nào bench có nhiều câu đồng nghĩa mà tầng này bỏ sót, sẽ xét lại embedding.

## 3. Quyết định

| # | Quyết định |
|---|---|
| I1 | **Thêm tầng thứ hai** `brain/src/intent.ts`, chạy sau khớp mẫu, nhắc việc và trí nhớ, sau bước nhận câu "nghiên cứu…", trước LLM. Chỉ chạy cho lệnh của chủ (`run.trusted`), như khớp mẫu |
| I2 | **Phân loại ý** bằng câu mẫu gần nhất: n-gram 3 ký tự của từng từ, cặp từ liền nhau ("độ ẩm" khác "độ"), từ đơn, trọng số TF-IDF, độ đo cosine. Trước khi so, bỏ từ đệm (bảng của `local.ts`) và **bỏ tên thiết bị, tên phòng**: tên nói *cái nào*, không nói *làm gì* |
| I3 | **Ý định:** bật, tắt, nhiệt độ, độ ẩm, CO₂, đi ngủ, tập trung, danh sách thiết bị, và một lớp "không phải việc nhà" (chuyện cười, hỏi đáp, cảm ơn, mở nhạc, buồn ngủ, trời nắng…) để những câu đó đi thẳng tới LLM |
| I4 | **Tham số lấy như khớp mẫu:** thiết bị theo tên gọi dài nhất trong sổ thiết bị, phòng theo tên phòng, "nó" là thiết bị vừa nhắc (M9). Hai thiết bị cùng tên mà không nói phòng thì để LLM hỏi lại |
| I5 | **Bật tắt khắt khe hơn đọc:** phải có động từ bật hoặc tắt ("sáng lên" tính là bật), động từ phải khớp với ý, và trong vế đó không có chữ phủ định, giờ giấc, điều kiện hay câu hỏi (`không`, `đừng`, `chưa`, `nếu`, `khi`, `sau`, `lúc`, số, `is`…). Thiếu một điều kiện thì đưa cho LLM |
| I6 | **Đọc cảm biến chỉ trả giá trị hiện tại:** câu xin lời khuyên, so sánh, hỏi nguyên nhân, hỏi hôm qua hay ngày mai (`nên`, `hơn`, `tại sao`, `hôm qua`, `ngày mai`…) đưa cho LLM |
| I7 | **Câu có dấu phẩy:** một vế không có động từ đứng cạnh lệnh ("trời tối rồi, bật đèn lên") là lời nhận xét, bỏ qua. Nhưng nếu vế đó gần một yêu cầu khác (lớp "không phải việc nhà") thì cả câu đưa cho LLM. Các vế nối bằng "và", "rồi" đều phải hiểu được |
| I8 | **Bench có thêm chế độ** `npm run bench -- --local`: in số lệnh đúng không tốn AI, số lệnh **sai** (phải là 0) và số câu để cho LLM, cho từng tầng. CI kiểm ≥ 80% và 0 lệnh sai (`brain/tests/bench.test.ts`) |

Câu mẫu được viết riêng, **không chép từ** `brain/bench/cases.jsonl`, để bench còn đo được khả năng hiểu câu mới. Riêng câu
"mình cần học bài 25 phút" trong bench được sửa thành chờ `minutes: 25`, vì đó mới là câu trả lời đúng (mock vẫn đạt 47/50, CI cần ≥ 45).

## 4. Kết quả (đo trên PC, 2026-11-28)

| Tầng | Đúng, không tốn AI | Sai | Để cho AI | Câu chậm nhất |
|---|---|---|---|---|
| Chỉ khớp mẫu | 17/41 (41%) | 0 | 33 | — |
| Khớp mẫu + hiểu theo nghĩa | **40/41 (98%)** | **0** | 10 | 5,7 ms (gồm lần dựng bộ phân loại đầu tiên) |

Câu duy nhất còn để cho AI là "bật ấm đun nước": sổ thiết bị không có tên "ấm đun nước", nên đúng là phải hỏi AI. 9 câu không cần
tool ("đừng bật đèn", "không cần tắt ổ cắm đâu", "bật quạt", "mở cửa gara"…) đều đi tới LLM.

**Bộ câu mới** (`brain/tests/intent.test.ts`, không dùng để viết câu mẫu): 13 câu nói khác hoặc nghe sai đều đúng; 22 câu không được
làm gì (phủ định, hẹn giờ, câu hỏi, thiết bị không có, xin lời khuyên…) đều đưa cho LLM. Bộ này đã bắt được một lỗi: "độ ẩm trong phòng ngủ ra sao rồi" bị đọc thành nhiệt độ. Lỗi được sửa chung bằng đặc
trưng cặp từ, không thêm câu mẫu riêng cho câu đó.

**Trên Pi 4 chưa đo** (Pi không có ở đây). Mỗi câu chỉ là vài nghìn phép nhân, nên chậm hơn PC 10 lần vẫn dưới mục tiêu 50 ms của
0012. Ghi số đo vào brief này khi có Pi.

## 5. Xong khi (0012 M11)

- [x] Trên bench, số lệnh làm đúng mà không gọi AI tăng rõ (41% → 98%, mục tiêu ≥ 80%) và không sai lệnh thiết bị nào.
- [x] Câu STT nghe hơi sai ("phòng mỹ độ") vẫn hiểu.
- [ ] Dưới 50 ms mỗi câu **trên Pi 4**: trên PC 5,7 ms, chờ đo trên Pi.

## 6. Ngoài phạm vi và giới hạn

- **Động từ bị nghe sai** ("bậc đèn" thay cho "bật đèn") chưa được sửa: tầng này cần động từ đúng chữ để bật tắt, nên những câu đó vẫn
  đi tới LLM. Cố ý: đoán động từ là chỗ dễ làm sai việc nhất.
- Thiết bị chưa có tên gọi trong sổ ("ấm đun nước") vẫn cần LLM. Cách sửa là thêm `aliases` cho thiết bị (M2), không phải đoán.
- Các việc đã có đường cục bộ riêng (lịch, mail, thời tiết, CI, nhắc việc) không đưa vào tầng này, để khỏi nhầm "đọc mail" với "gửi
  mail".
- Model embedding: xét lại khi bench có nhiều câu đồng nghĩa khác hẳn chữ mà tầng này bỏ sót.
