# Cờ Tướng (Xiangqi) — Giao diện Web Tĩnh

Giao diện bàn cờ tướng phong cách mộc mạc như một bộ cờ gỗ đặt trên bàn trà: vân gỗ ngang dịu mắt, quân cờ ngà tiện 3D khắc thư pháp truyền thống, luật cờ tướng đầy đủ, âm thanh + giọng tướng quân cổ đại, và chế độ **Đấu máy** chạy hoàn toàn offline bằng Web Worker.

---

## Chế độ chơi & Cấp độ AI

- **Hai người**: chơi trực tiếp 2 người trên cùng máy (hỗ trợ bật tùy chọn *Đi tự do (luyện tập)* để xếp thế cờ).
- **Đấu máy**: chọn cầm **Đỏ** hoặc **Đen** (nếu cầm Đen, bàn cờ tự động xoay và máy đi trước), với 4 cấp độ:
  - **Tập sự**: độ sâu 2 (`150 ms`), chọn ngẫu nhiên trong nhóm nước tốt và thỉnh thoảng đi nước mềm hơn để người mới dễ luyện tập.
  - **Nghiệp dư**: độ sâu 4 (`500 ms`), chọn đa dạng trong biên độ `30 cp`.
  - **Cao thủ**: độ sâu tối đa 8 (`2500 ms`), luôn chọn nước tối ưu.
  - **Đại sư**: độ sâu tối đa 12 (`6000 ms`), dùng toàn bộ bảng băm chuyển thế (`2^20` mục).
- **Gợi ý (`Gợi ý (3)`)**: tối đa 3 lần mỗi ván trong chế độ Đấu máy — vẽ mũi tên xanh dương chỉ nước đi tốt nhất trong `2.5 s`.
- **Đầu hàng**: xác nhận kết thúc ván đấu với máy.

### Tinh chỉnh hàm đánh giá (Evaluation)
Tất cả trọng số vật chất, bảng vị trí quân (PST cho Tốt, Mã, Pháo, Xe, Sĩ, Tượng, Tướng), thưởng cặp Sĩ/Tượng phòng thủ, độ cơ động và thưởng nhịp đi nằm trong `js/ai/eval.js` (các hằng số có chú thích rõ ràng). Tham số độ sâu / thời gian từng cấp độ nằm trong `js/ai/levels.js`.

---

## Cách chạy

Ứng dụng dùng ES Modules và cầu nối UCI cục bộ (`tools/server.py`) để kết nối **Pikafish**:

### Bước 1: Tải Pikafish (chỉ chạy 1 lần, cần mạng)
```powershell
python tools/setup_engine.py
```
Lệnh này tự tải bản phát hành Pikafish mới nhất (kèm mạng `pikafish.nnue`), kiểm tra bản thực thi phù hợp CPU và tạo `engine/engine.json`. Nếu bỏ qua bước này (hoặc chạy bằng `python -m http.server`), trò chơi tự động chuyển sang **máy Nội bộ (JS)** và hiển thị gợi ý nhỏ trong bảng điều khiển.

### Bước 2: Chạy trò chơi
- **Windows**: nhấn đúp [run.bat](run.bat) — tự khởi chạy `python tools/server.py --port 8000` và mở `http://localhost:8000`.
- **Dòng lệnh**:
  ```powershell
  python tools/server.py --port 8000
  ```
- Trong chế độ **Đấu máy**, chuyển đổi nhanh giữa **Pikafish** và **Nội bộ (JS)** ngay trên thanh chọn `Máy:`.
- **Giấy phép Pikafish**: tệp thực thi tuân theo **GPL v3** (`engine/LICENSE`), mạng `pikafish.nnue` không dùng thương mại khi chưa có phép (xem `engine/README.md`).

---

## Tham số URL & Công cụ kiểm thử

- `http://localhost:8000/` — Giao diện chơi chính (mặc định chủ đề **Gỗ Lim**).
- `http://localhost:8000/?theme=ngoc-bich` — Mở trực tiếp với chủ đề **Ngọc Bích**.
- `http://localhost:8000/?gallery` — Thư viện 14 quân cờ ở 3 kích thước (`64`, `88`, `140 px`) trên nền gỗ và nền xám trung tính.
- `http://localhost:8000/?preview=board` — Chỉ hiển thị bàn cờ (`1050×1150`).
- `http://localhost:8000/?preview=pieces` — Bảng 14 quân cờ `7×2` (`240 px/ô`).
- `http://localhost:8000/?preview=pieces_small` — Bảng 14 quân cờ `7×2` (`88 px/ô`).
- `http://localhost:8000/?preview=start` — Bàn cờ + 32 quân ở thế cờ xuất phát (hỗ trợ kèm `&theme=ngoc-bich`).

### Chạy unit test & chụp ảnh xem trước
```powershell
node --test tests/model.test.js
python tools/shot.py all
python tools/verify.py
```

---

## Phím tắt

| Phím | Chức năng |
|---|---|
| `Ctrl + Z` | Đi lại nước vừa đi (khôi phục cả quân bị ăn) |
| `N` | Bắt đầu ván mới (có hộp thoại xác nhận nếu đã có nước đi) |
| `F` | Xoay bàn cờ 180° (chữ trên quân luôn đứng thẳng) |
| `Esc` | Hủy chọn quân / hủy kéo thả / đóng hộp thoại / thoát xem lại / bỏ qua hiệu ứng |
| `←` / `→` | Xem nước trước / nước sau trong lịch sử |
| `Home` / `End` | Nhảy về thế ban đầu / về nước hiện tại |
| `Space` | Tự động phát / tạm dừng xem lại (mỗi 800 ms) |

---

## Xem lại ván cờ (Review Mode) & Danh sách nước đi

- **Nhấn trực tiếp**: nhấn vào bất kỳ nước đi nào (hoặc chip **Thế ban đầu**, số thứ tự hàng `#`) để xem thế cờ tại thời điểm đó mà không làm thay đổi ván đấu thực tế.
- **Thanh điều khiển & bàn phím**: dùng các nút `⏮ ◀ ▶ ⏭ ⏯` hoặc phím `←`, `→`, `Home`, `End`, `Space`, `Esc`.
- **Thanh thời gian (Timeline)**: kéo ngang trên dải vạch màu dưới danh sách nước đi để tua nhanh từng nước kèm chú thích nổi.
- **Chơi tiếp từ đây**: khi đang xem lại, nhấn **Chơi tiếp từ đây** trên thanh thông báo đầu bàn cờ để cắt các nước phía sau và tiếp tục ván đấu từ thế cờ đang xem.

---

## Hiệu ứng kết thúc ván cờ & Trang xem trước (`?effects`)

- Ba bộ hiệu ứng điện ảnh thuần SVG + Canvas 2D + Web Audio theo giao diện đang chọn (`Gỗ Lim` vàng ấm / `Ngọc Bích` ngọc lam):
  - **Thắng** (*Song kiếm giao phong*): vết nứt trên tướng bị chiếu bí, hai thanh kiếm giao phong, tia lửa, thư pháp **勝** và ấn đỏ **將**.
  - **Thua / Đầu hàng** (*Bại trận* / *Đầu hàng*): bàn cờ giảm bão hòa, kiếm cắm xuống (hoặc cờ trắng phất cho Đầu hàng), thư pháp **敗** / **投降** và tro bay.
  - **Hòa** (*Hạ kiếm*): sương nhẹ, hai thanh kiếm chạm nhẹ rồi hạ chéo trước vòng Thái Cực và thư pháp **和**.
- Mở trang thử hiệu ứng độc lập tại: `http://localhost:8000/?effects` (chọn hiệu ứng, đổi giao diện, chỉnh tốc độ `0.25x–2x`, bật/tắt âm thanh).
- **Tinh chỉnh mốc thời gian**: toàn bộ hằng số thời gian (`clashDefault`, `titleStart`, `sealStart`, `end`, ...) nằm ở đầu tệp `js/fx/endFx.js` (`FX_TIMINGS`).

---

## Cấu trúc thư mục

```text
Chinese Chess/
├─ index.html                  # Trang chính (preload font + bố cục)
├─ run.bat                     # Khởi chạy nhanh trên Windows
├─ css/
│  └─ style.css                # Giao diện tối, panel bên phải, hiệu ứng & modal
├─ js/
│  ├─ main.js                  # Điểm vào ứng dụng, phím tắt, chuyển giao diện
│  ├─ theme.js                 # Định nghĩa Theme + 2 preset (Gỗ Lim, Ngọc Bích)
│  ├─ rules.js                 # Giao diện RulesProvider + PermissiveRules (v1)
│  ├─ engine.js                # Stub giao diện Engine (dành cho UCI sau này)
│  ├─ model/
│  │  ├─ piece.js              # Side, Kind, Piece, ánh xạ ký tự FEN
│  │  ├─ moves.js              # Pos, Move, định dạng ICCS (vd: h2e2)
│  │  ├─ fen.js                # Đọc / xuất FEN cờ tướng & START_FEN
│  │  └─ board.js              # Trạng thái bàn cờ & ngăn xếp Undo
│  ├─ render/
│  │  ├─ boardSvg.js           # Sinh SVG bàn cờ 6 lớp (vân gỗ feTurbulence)
│  │  └─ pieceSvg.js           # Sinh 14 <symbol> quân cờ 7 lớp + gallery/sheet
│  └─ ui/
│     ├─ anim.js               # Bộ lịch tween theo nhu cầu (0% CPU khi rảnh)
│     ├─ boardView.js          # Vẽ quân, hit-test, click-click, kéo-thả, xoay
│     └─ sidePanel.js          # Thẻ người chơi, khay quân ăn, danh sách nước đi
├─ assets/fonts/
│  ├─ LXGWWenKaiTC-Subset.ttf  # Font thư pháp đã rút gọn bằng pyftsubset (~43 KB)
│  └─ LICENSE-OFL.txt          # Giấy phép SIL Open Font License 1.1
├─ tests/model.test.js         # Unit test cho FEN, applyMove/undo, PermissiveRules
├─ tools/                      # Script chụp preview/ và kiểm thử trình duyệt
└─ docs/
   ├─ DECISIONS.md             # Quyết định kiến trúc & các điểm khác DESIGN.md
   └─ PROGRESS.md              # Nhật ký tiến độ từng bước
```

---

## Font chữ & Bản quyền

- **Thư pháp trên bàn cờ và quân cờ**: [LXGW WenKai TC (霞鶩文楷 TC)](https://github.com/lxgw/LxgwWenkaiTC) — phát hành theo giấy phép **SIL Open Font License 1.1** (xem [assets/fonts/LICENSE-OFL.txt](assets/fonts/LICENSE-OFL.txt)). Được rút gọn bằng `fonttools` (`pyftsubset`) chỉ giữ các chữ Hán, chữ số và ký tự cần thiết (~43 KB).
- **Chữ giao diện tiếng Việt**: Hệ thống font mặc định (`Segoe UI` trên Windows, `system-ui`, `sans-serif`), hiển thị đầy đủ dấu tiếng Việt.

---

## Bước tiếp theo (Thay thế bằng Pikafish WASM)

Toàn bộ bộ máy tìm kiếm hiện tại cài đặt giao diện `Engine` (`js/engine.js`) và giao tiếp qua Web Worker (`js/ai/worker.js` / `js/ai/client.js`). Khi muốn nâng cấp lên sức mạnh đại kiện tướng, bạn có thể biên dịch **Pikafish** sang WebAssembly (`pikafish.wasm` + `pikafish.js`), nạp bên trong `js/ai/worker.js` và chuyển tiếp lệnh UCI (`position fen ...` / `go movetime ...`) mà không cần sửa bất kỳ dòng mã giao diện nào.
