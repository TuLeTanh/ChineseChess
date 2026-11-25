# Phân tích ván cờ (Game Analysis)

Tài liệu mô tả kiến trúc, thuật toán chấm điểm, và giao diện của tính năng **Phân tích ván cờ** (hỗ trợ **Cờ Tướng**, chạy bằng **Pikafish UCI + WDL** hoặc tự động dự phòng bằng **Nội bộ (JS)** Web Worker).

## 1. Quy tắc công bằng (Integrity Rule & Ngoại lệ P4)

- **Đấu máy (AI) và Đấu Online**: Phân tích **chỉ** khả dụng sau khi ván cờ kết thúc (từ thẻ kết quả, màn hình xem lại ván đã lưu, hoặc liên kết chia sẻ). Trong khi đang chơi trực tiếp, nút **Phân tích**, thanh đánh giá và mũi tên phân tích bị ẩn hoàn toàn; liên kết sâu tới ván AI/Online chưa kết thúc (`result === 'unfinished'`) cũng bị chặn.
- **Hai người trên cùng máy (Local 2-player Cờ Tướng — Ngoại lệ học tập)**: Cho phép mở **Phân tích** trực tiếp ngay trong ván (phân tích từng thế cờ theo thời gian thực với độ trễ gom `250 ms`, Pikafish `1000 ms` hoặc JS độ sâu `5`, kèm nút **Phân tích cả ván**), và cho phép mở lại từ thư viện kể cả khi ván chưa kết thúc.
- **Cờ Úp (Jieqi)**: Chưa hỗ trợ phân tích ở mọi chế độ; nút **Phân tích** được ẩn và menu `⋯` hiển thị dòng ghi chú *"Cờ Úp chưa hỗ trợ phân tích"*.
- Nếu người dùng chọn **Chơi tiếp từ đây** từ màn hình xem lại, ván mới bắt đầu sạch sẽ (trừ chế độ Hai người nơi người dùng có thể chủ động mở lại **Phân tích**).

## 1b. Giao diện Phân tích Toàn bảng (Full-Swap)

Khi bấm **Phân tích**, toàn bộ bảng bên phải (hoặc bảng trượt toàn màn hình trên điện thoại) được thay thế bởi bảng Phân tích gồm các khối rõ ràng:
- **Thanh tiêu đề cố định**: `← Về ván` (hoặc phím `Esc` để quay về và giữ nguyên vị trí cuộn), tên động cơ (`Pikafish` / `Nội bộ`), và menu `⋯` chọn mức độ (`Nhanh` / `Chuẩn` / `Sâu`).
- **Thẻ Nhận định (5 mức tiếng Việt)** theo tỷ lệ thắng của Đỏ:
  - `≥ 75%`: **Đỏ lợi thế lớn**
  - `58% – 75%`: **Đỏ ưu thế**
  - `42% – 58%`: **Cân bằng**
  - `25% – 42%`: **Đen ưu thế**
  - `< 25%`: **Đen lợi thế lớn**
- **Thẻ Chất lượng nước đi**: hiển thị phân loại, câu giải thích tiếng Việt về mức tụt tỷ lệ thắng, nút **Xem nước tốt hơn** và **Thử nước này**.
- **Phương án tiếp theo (6 nước / 3 lượt mỗi bên)**: mọi nước trong chuỗi PV đều được kiểm tra hợp lệ qua `XiangqiRules`. Bấm vào bất kỳ thẻ nước nào để xem trước bàn cờ không phá hủy lịch sử (*"Đang xem phương án của máy"*, mũi tên đánh số `1..6`, nhấn `Esc` hoặc **Thoát** để quay lại). Nút **Sâu hơn** mở rộng lên **8 nước** (lưu kèm trong cache phân tích).
- **Thanh đánh giá (`EvalBar`)**: rộng `24 px` trên máy tính (chỉ số luôn cách mép `≥ 4 px`, tự đảo đầu ở thế cực đoan) và ngang `10 px` trên điện thoại dọc.

## 2. Động cơ phân tích

### Pikafish (ưu tiên khi chạy `tools/server.py`)
- Bật `UCI_ShowWDL = true`, `Hash = 128 MB`, `MultiPV = 2`, gọi `ucinewgame` một lần ở đầu phiên.
- Endpoint `POST /api/engine/analyze` nhận `{ id, startFen, moves, movetime_ms, multipv }` (trả `202 Accepted`, hoặc `409 Conflict` nếu động cơ đang bận) và phát trực tiếp các sự kiện `pos` (`ply: 0..N`) + `done` qua SSE `GET /api/engine/stream?id=...`.
- Hủy phân tích qua `POST /api/engine/stop` (`< 500 ms`), giữ lại phần đã phân tích và gắn nhãn **Chưa đầy đủ**.
- Ba mức thời gian: **Nhanh** (`150 ms/nước`), **Chuẩn** (`600 ms/nước`), **Sâu** (`2000 ms/nước`).

### Nội bộ (JS) Web Worker (dự phòng tự động)
- Khi không có `tools/server.py` (ví dụ mở qua `node server/index.js --lan` trên điện thoại), `js/analysis/analyzer.js` tự động chạy phân tích từng thế cờ trên `js/ai/worker.js` (không khóa giao diện):
  - **Nhanh**: độ sâu 4
  - **Chuẩn**: độ sâu 5
  - **Sâu**: độ sâu 6

## 3. Chuẩn hóa điểm, tỷ lệ thắng và phân loại nước đi (`js/analysis/math.js`)

- Mọi điểm đánh giá và bộ `WDL [W, D, L]` đều được chuẩn hóa về **góc nhìn quân Đỏ** (`+` lợi cho Đỏ, `-` lợi cho Đen).
- **Tỷ lệ thắng (`winPercent`)**:
  - Nếu động cơ trả về `WDL` hợp lệ (`W + D + L > 0`): $100 \times \frac{W + 0.5 D}{W + D + L}$.
  - Nếu là chiếu bí bắt buộc (`mate`): `100%` (hoặc `0%`).
  - Ngược lại dùng hàm logistic với hằng số $K = 150$: $\frac{100}{1 + e^{-cp / 150}}$.
- **Độ chính xác từng nước (`moveAccuracy`)** theo công thức kiểu Lichess từ mức tụt tỷ lệ thắng $\Delta W$:
  $$\text{acc}(\Delta W) = \text{clamp}_{[0, 100]}\!\left(103.1668 \cdot e^{-0.04354 \cdot \Delta W} - 3.1669\right)$$
- **Phân loại nước đi**:
  - `★` **Tốt nhất** (`best`): trùng nước tốt nhất của động cơ, hoặc $\Delta W < 2\%$ (hoặc ply 1–2 khai cuộc với $\Delta W < 5\%$).
  - `!` **Nước duy nhất** (`only_move`): trùng nước tốt nhất và nước tốt thứ hai tụt $\ge 15\%$.
  - `✓` **Tốt** (`good`): $\Delta W < 5\%$.
  - `?!` **Thiếu chính xác** (`inaccuracy`): $5\% \le \Delta W < 10\%$.
  - `?` **Sai lầm** (`mistake`): $10\% \le \Delta W < 20\%$.
  - `??` **Sai lầm nghiêm trọng** (`blunder`): $\Delta W \ge 20\%$.
  - `??` **Bỏ lỡ chiếu bí** (`missed_mate`): có chiếu bí bắt buộc trước nước đi nhưng đánh mất sau nước đi.

## 4. Lưu trữ và Xuất

- Kết quả phân tích được lưu trong IndexedDB `xq_games_v1` (phiên bản schema `v2`, kho `analysis`, khóa xác định theo `startFen + moves`, giới hạn 100 bản phân tích, tự động dọn bản cũ nhất khi đầy, xóa sạch cùng `clearAll()`).
- Thư viện ván hiển thị huy hiệu **Độ chính xác: Đỏ X% · Đen Y%** cho các ván đã phân tích.
- Hộp thoại **Xuất** có tùy chọn **Kèm phân tích đã lưu** cho file `.xqgame.json`; không bao giờ nhúng dữ liệu phân tích vào liên kết chia sẻ hoặc file `.pgn`.
