# Phân tích ván cờ (Game Analysis)

Tài liệu mô tả kiến trúc, thuật toán chấm điểm, và giao diện của tính năng **Phân tích ván cờ** (hỗ trợ **Cờ Tướng**, chạy bằng **Pikafish UCI + WDL** hoặc tự động dự phòng bằng **Nội bộ (JS)** Web Worker).

## 1. Quy tắc công bằng (Integrity Rule)

- Phân tích **chỉ** khả dụng sau khi ván cờ kết thúc (từ thẻ kết quả, màn hình xem lại ván đã lưu, hoặc liên kết chia sẻ).
- Trong khi đang chơi ván trực tiếp (Hai người, Đấu máy, hoặc Đấu Online), không hiển thị thanh đánh giá, mũi tên phân tích hay nút phân tích.
- Nếu người dùng chọn **Chơi tiếp từ đây** từ màn hình xem lại, ván mới bắt đầu sạch sẽ và không mang theo bảng phân tích.
- **Cờ Úp (Jieqi)**: chưa hỗ trợ phân tích (hiển thị thông báo *"Cờ Úp chưa hỗ trợ phân tích"* và khóa nút chạy).

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
