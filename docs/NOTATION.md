# Ghi nước đi kiểu truyền thống (Vietnamese Traditional Notation)

Ứng dụng hiển thị nước đi bằng **ký hiệu cờ tướng truyền thống tiếng Việt** (mặc định **Bật**), có thể chuyển tức thì sang **tọa độ (`h2e2`)** trong **Cài đặt → Giao diện** hoặc menu **`⋯`** ngay trong bàn cờ.

> **Nguyên tắc cốt lõi (Display-Only):** Tọa độ ICCS (`h2e2`, `h9g7`, …) vẫn là định dạng chuẩn duy nhất dùng để lưu trữ (`IndexedDB`), xuất/nhập (`.xqgame.json`, `.pgn`, liên kết `#/replay?g=...`), gửi qua mạng online (`WebSocket`), và giao tiếp engine (`UCI` / `Pikafish`). Ký hiệu truyền thống chỉ sinh ra ở tầng hiển thị từ `(boardBefore, iccsMove)` nên không bao giờ ảnh hưởng luật cờ, engine hay tương thích dữ liệu cũ.

---

## 1. Ngữ pháp tiếng Việt & 3 quy tắc cốt lõi

Mỗi nước đi gồm 4 phần:

```
TÊN_QUÂN  CỘT (hoặc VỊ_TRÍ)  HƯỚNG  SỐ
```

- **Tên quân** (đồng nhất cho cả Đỏ và Đen, định nghĩa tại một nơi duy nhất [`js/notation/names.js`](../js/notation/names.js)):
  `Tướng`, `Sĩ`, `Tượng`, `Xe`, `Pháo`, `Mã`, `Tốt`.
- **Quy tắc 1 — Đếm cột từ bên PHẢI của người đi (1 → 9):**
  - Với quân **Đỏ**: cột `i` = `1`, `h` = `2`, …, `e` = `5`, …, `a` = `9` (`fileNum = 9 - fileIdx`).
  - Với quân **Đen**: cột `a` = `1`, `b` = `2`, …, `e` = `5`, …, `i` = `9` (`fileNum = fileIdx + 1`).
  - Quy ước này **không bao giờ phụ thuộc** việc người dùng có xoay bàn trên màn hình hay không.
- **Quy tắc 2 — Hướng đi:**
  - `tiến` (`+`): tiến về phía đối thủ (Đỏ tăng hàng `r2 > r1`, Đen giảm hàng `r2 < r1`).
  - `thoái` (`−`, ký tự toán học U+2212): lùi về phía sân mình.
  - `bình` (`=`): đi ngang trên cùng một hàng (`r2 === r1`).
- **Quy tắc 3 — Số cuối cùng:**
  - Quân đi **thẳng** (`Tướng`, `Xe`, `Pháo`, `Tốt`): khi `tiến`/`thoái` là **số bước đi** (`|r2 - r1|`); khi `bình` là **số cột đến**.
  - Quân đi **chéo hoặc chữ L** (`Sĩ`, `Tượng`, `Mã`): luôn là **số cột đến** (tính theo người đi).

### Dạng rút gọn (Short form)
Dùng ở không gian hẹp (ô nước đi `< 112 px`, dải nước đi điện thoại, chip PV 6 nước):
- `+` thay cho `tiến`
- `−` (U+2212) thay cho `thoái`
- `=` thay cho `bình`
- Ví dụ: `Pháo 2 bình 5` → `Pháo 2=5`, `Mã 2 tiến 3` → `Mã 2+3`, `Xe 2 thoái 4` → `Xe 2−4`.

### Phân biệt nhiều quân cùng loại trên cùng một cột
Tính từ **quân gần đối thủ nhất** trở về sân nhà (nhiều nhất 5 quân Tốt):
- **2 quân cùng loại trên cùng 1 cột**: `Trước` (gần đối thủ hơn) / `Sau` (xa hơn) — ví dụ `Trước Pháo bình 5` (`Trước Pháo=5`), `Sau Tốt tiến 1` (`Sau Tốt+1`).
- **3 quân**: `Trước` / `Giữa` / `Sau`.
- **4 quân**: `1`, `2`, `3`, `4` (ví dụ `Tốt 1 tiến 1`).
- **5 quân**: `1`, `2`, `3`, `4`, `5`.
- **Nhiều cột cùng có cặp quân trùng loại** (ví dụ hai cột đều có 2 Tốt): giữ nguyên tiền tố vị trí + số cột (ví dụ `Trước Tốt 3 tiến 1` / `Trước Tốt 3+1`) để đảm bảo tính đơn ánh (injective) và đọc lại được 100%.

---

## 2. Bảng chuẩn đối chiếu (Golden Table)

| Bên đi | Tọa độ | Dạng đầy đủ (`full`) | Dạng rút gọn (`short`) |
|---|---|---|---|
| Đỏ | `h2e2` | `Pháo 2 bình 5` | `Pháo 2=5` |
| Đỏ | `b2e2` | `Pháo 8 bình 5` | `Pháo 8=5` |
| Đỏ | `h0g2` | `Mã 2 tiến 3` | `Mã 2+3` |
| Đỏ | `b0c2` | `Mã 8 tiến 7` | `Mã 8+7` |
| Đỏ | `g0e2` | `Tượng 3 tiến 5` | `Tượng 3+5` |
| Đỏ | `c0e2` | `Tượng 7 tiến 5` | `Tượng 7+5` |
| Đỏ | `f0e1` | `Sĩ 4 tiến 5` | `Sĩ 4+5` |
| Đỏ | `d0e1` | `Sĩ 6 tiến 5` | `Sĩ 6+5` |
| Đỏ | `i0i1` | `Xe 1 tiến 1` | `Xe 1+1` |
| Đỏ | `a0a1` | `Xe 9 tiến 1` | `Xe 9+1` |
| Đỏ | `g3g4` | `Tốt 3 tiến 1` | `Tốt 3+1` |
| Đỏ | `c3c4` | `Tốt 7 tiến 1` | `Tốt 7+1` |
| Đỏ | `e0e1` | `Tướng 5 tiến 1` | `Tướng 5+1` |
| Đen | `h9g7` | `Mã 8 tiến 7` | `Mã 8+7` |
| Đen | `b9c7` | `Mã 2 tiến 3` | `Mã 2+3` |
| Đen | `h7e7` | `Pháo 8 bình 5` | `Pháo 8=5` |
| Đen | `b7e7` | `Pháo 2 bình 5` | `Pháo 2=5` |
| Đen | `g9e7` | `Tượng 7 tiến 5` | `Tượng 7+5` |
| Đen | `c9e7` | `Tượng 3 tiến 5` | `Tượng 3+5` |
| Đen | `f9e8` | `Sĩ 6 tiến 5` | `Sĩ 6+5` |
| Đen | `d9e8` | `Sĩ 4 tiến 5` | `Sĩ 4+5` |
| Đen | `i9i8` | `Xe 9 tiến 1` | `Xe 9+1` |
| Đen | `a9a8` | `Xe 1 tiến 1` | `Xe 1+1` |
| Đen | `g6g5` | `Tốt 7 tiến 1` | `Tốt 7+1` |

---

## 3. Chính sách Cờ Úp (Jieqi — No-Peeking)

- Với quân **đang úp**, ký hiệu truyền thống **chỉ sử dụng vai trò giả theo ô xuất phát** (đồng nhất với luật di chuyển công khai của quân úp), **tuyệt đối không đọc quân thật ẩn bên dưới**.
- Nhãn `LẬT` giữ nguyên cạnh nước đi khi quân được lật; tooltip (`title`) chỉ hiển thị quân thật sau khi đã công khai (ví dụ `b2e2 · lật ra Tốt`).
- Đã kiểm chứng tự động bằng test không nhìn trộm (`tests/notation/traditional.test.js` #8): cùng một thế cờ công khai với 20 cách xáo bí mật khác nhau luôn cho đầu ra giống hệt từng byte.

---

## 4. Tùy chỉnh tên quân (`js/notation/names.js`)

Toàn bộ từ vựng hiển thị được gom vào một file duy nhất [`js/notation/names.js`](../js/notation/names.js):
- `PIECE_NAMES`: đổi `Tốt` → `Binh`, `Tượng` → `Tịnh`, `Tướng` → `Soái`… tại một chỗ là tự động cập nhật toàn bộ UI, hộp thoại hướng dẫn và trình phân tích chuỗi.
- `DIRECTION_WORDS` / `DIRECTION_SYMBOLS`: `tiến`/`thoái`/`bình` và `+`/`−`/`=`.
- `POSITION_WORDS`: quy ước `Trước`/`Giữa`/`Sau` và `1..5`.

---

## 5. Mọi vị trí hiển thị nước đi (Where moves are shown)

| Vị trí | File & hàm | Selector / Phần tử | Ghi chú |
|---|---|---|---|
| Danh sách nước đi (desktop & bottom sheet) | `js/ui/sidePanel.js` (`_buildChipHtml`) | `button.move-chip[data-ply] .move-text`, `title`, `aria-label` | CSS `@container (min-width: 112px)` tự chọn `full`/`short`; luôn giữ `data-move="<iccs>"` |
| Tooltip thanh thời gian (timeline) | `js/ui/sidePanel.js` (`showTip`) | `.timeline-tooltip` | Hiện `"nước N: <full/coord>"` khi rê/kéo trên `.move-timeline` |
| Dải nước đi điện thoại (horizontal strip) | `js/ui/moveStrip.js` (`update`) | `button.mstrip-chip[data-ply] .mstrip-iccs` | Hiện `short` ở chế độ truyền thống, `coord` ở chế độ tọa độ; giữ `data-move="<iccs>"` |
| Phân tích — Thẻ chất lượng nước đi | `js/ui/analysisView.js` (`_renderQuality`) | `[data-testid="an-quality-card"] .an-quality-mv`, `.an-quality-desc` | Hiển thị `"Nước N: <main> (<other>)"` và `"Nước tốt hơn: <main> (<other>)"` |
| Phân tích — Phương án tiếp theo (PV 6/8 nước) | `js/ui/analysisView.js` (`_renderNextMoves`) | `.an-pv-chip` | Replay bằng `formatLine()`; dạng `short`, kèm `data-move="<iccs>"` và `title` |
| Phân tích — Hàng "Nước đã đi" | `js/ui/analysisView.js` (`_renderNextMoves`) | `[data-testid="an-played-row"]` | Hiển thị `"Nước đã đi: <main> (<other>)"` |
| Phân tích — Danh sách "Sai lầm lớn nhất" | `js/ui/analysisView.js` (`_renderSummary`) | `button.an-mistake-item[data-jump-ply]` | Hiển thị `"Nước N (Đỏ/Đen): <main> (<other>)"` |
| Hộp thoại hướng dẫn `Cách đọc nước đi` | `js/ui/notationHelpModal.js` | `[data-testid="notation-help-modal"]` | Mở từ **Cài đặt → Giao diện → `? Cách đọc`** hoặc menu **`⋯` → `Cách đọc nước đi`** |
| Cài đặt → Giao diện & Menu `⋯` | `js/ui/settingsModal.js`, `js/ui/sidePanel.js` | `[data-testid="set-notation-toggle"]`, `[data-mitem="notation"]` | Chuyển tức thì không tải lại ván, lưu trong `xq_settings_v1.notation` |
| Thư viện ván & Bàn cờ | `js/screens/libraryScreen.js`, `js/ui/boardView.js` | Chỉ hiện số nước (`N nước`) và mũi tên SVG | Không in chuỗi nước đi |

### Kiểm thử hồi quy
- Unit tests (`tests/notation/traditional.test.js`): 8/8 bài kiểm tra (Golden table 24 dòng, Thoái/Bình 7 quân, trùng cột 2/3/4/5 + đa cột, đối xứng 200 thế cờ, đơn ánh & khứ hồi 300 Cờ Tướng + 300 Cờ Úp + fuzz, regex & `ariaLabel`, `formatLine` 6 nước + cắt nước bất hợp lệ, Cờ Úp không nhìn trộm 20 bộ bí mật).
- Playwright E2E (`tools/verify_notation.py`): N1–N8 (mặc định truyền thống, chuyển tức thì & lưu `localStorage`, danh sách + tooltip + `aria-label` + không tràn, dải điện thoại, phân tích 2 dạng, Cờ Úp `LẬT`, menu `⋯` + hộp thoại hướng dẫn, hiệu năng chuyển đổi 150 nước `< 50 ms` ở 4× CPU throttle).
- `tools/verify_dialogs.py`: đã bổ sung kiểm tra hộp thoại `notation_help` trên toàn bộ kích thước màn hình (Chromium + WebKit).
- `tools/verify.py`: cập nhật 3 assertion cũ sang đọc `data-move` + hậu tố `+`/`#` để tương thích với mặc định ghi truyền thống.
