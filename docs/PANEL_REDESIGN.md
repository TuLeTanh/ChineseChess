# Panel & Analysis Redesign Map (`feat/compact-panel`)

Tài liệu ánh xạ toàn bộ thành phần hiện tại của bảng bên (`SidePanel`, `gameScreen`, `replayScreen`, `analysisView`, `evalBar`) sang kiến trúc mới gọn gàng, không cuộn thừa ở máy tính và hoán đổi toàn bộ bảng khi mở **Phân tích**.

## 1. Bảng ánh xạ điều khiển (Hiện tại → Mới)

| Thành phần hiện tại | Vị trí cũ | Vị trí mới (Desktop / Side) | Vị trí mới (Phone Stack) | Ghi chú / Quy tắc |
|---|---|---|---|---|
| `← Sảnh` / `← Thư viện`, `⚙` | `.game-top-nav` | Giữ nguyên | Giữ nguyên | Không thay đổi |
| Nút **Phân tích** | Chỉ có ở thẻ kết quả & màn hình `replayScreen` | Header bảng bên (trái, cao 44 px, viền vàng) | Thanh điều khiển dưới (`mobile-controls-bar`) mở sheet ở `full` + tab `Phân tích` | Theo `panelPolicy().showAnalysis` (P4) |
| Nút **⋯** (Menu tràn) | Chưa có | Header bảng bên (phải, popover có phím mũi tên & `Esc`) | Tab `Tùy chọn` trong Bottom Sheet | Chứa toàn bộ tác vụ phụ |
| Chọn chế độ / bên / cấp độ / engine (`.mode-bar`, `.ai-config-row`, `.engine-row`) | Luôn hiển thị trên đầu bảng bên | Bỏ khỏi bảng mặc định; chuyển vào mục *"Đổi cấp độ / bên / engine (áp dụng cho ván mới)"* trong menu **⋯** (chế độ `ai`) | Trong tab `Tùy chọn` | Route đã mang `side/level/engine` |
| Thẻ đối thủ (`.player-card-black` / trên) | Trong bảng bên | Dòng 2: quân tròn + tên (ellipsis) + máy/chấm kết nối + đồng hồ + khay quân ăn 1 dòng (ẩn thanh cuộn + fade) | Dải đối thủ trên bàn cờ (`grid-area: opp`) | Bên đến lượt có viền vàng |
| Danh sách nước đi + timeline + nút duyệt (`⏮ ◀ ▶ ⏭ ⏯`) | Trong bảng bên (`min-height: 110px`) | Dòng 3 (`flex: 1; min-height: 0`, tối thiểu 6 hàng hiển thị ở cao 780 px); cụm điều hướng gom 1 hàng 36 px | Tab `Nước đi` + dải cuộn ngang `MoveStrip` | Chỉ danh sách nước đi được cuộn |
| Bảng quân úp còn lại (`.jieqi-pool-panel`) | Khối lớn nhiều dòng | Giữ cho **Cờ Úp**, thu gọn thành 1 dòng tóm tắt | Tab `Quân úp` | Ẩn ở Cờ Tướng |
| Thẻ người chơi (`.player-card-red` / dưới) | Trong bảng bên | Dòng 4 (cùng cấu trúc thẻ đối thủ) | Dải người chơi dưới bàn cờ (`grid-area: me`) | — |
| Dòng trạng thái lượt/chiếu/máy nghĩ | Trong `.status-block` | Dòng 5 (1 dòng gọn, `aria-live="polite"`) | Trong dải người chơi + tab `Tùy chọn` | Không có checkbox luyện tập trên mặt mặc định |
| Hàng tác vụ chính (`.panel-action-row`) | Rải rác ở `.ai-actions-row`, `.online-actions-row`, `.controls-grid`, `.archive-actions-bar` | Dòng 6 (40 px desktop, ≥44 px cảm ứng):<br>• **AI**: `[Đầu hàng]`<br>• **Hai người**: `[Đi lại] [Hòa] [Đầu hàng]` (Cờ Úp giữ `Đi lại` ở Hai người)<br>• **Online**: `[Xin hòa] [Đầu hàng]`<br>• **Xem lại/Lưu trữ**: `[Về hiện tại] [Chơi tiếp từ đây]` | Thanh điều khiển dưới (`mobile-controls-bar`) | "Hòa" ở Hai người mở hộp thoại xác nhận; "Đầu hàng" ở Hai người hỏi bên nào đầu hàng (`Đỏ` / `Đen`) |
| `Gợi ý (n)` | `.ai-actions-row` trên mặt bảng | Chuyển vào menu **⋯** (chỉ chế độ `ai`) | Trong tab `Tùy chọn` (chế độ `ai`) | Giữ nguyên giới hạn 3 lần/ván |
| `Ván mới`, `Xoay bàn`, `Giao diện`, `Âm thanh / Giọng nói`, `Lưu / Xuất`, `Cài đặt` | `.controls-grid`, `.audio-bar`, `.side-export-row` trên mặt bảng | Gom vào menu **⋯** (giữ nguyên khóa xuất khi ván đang chơi) | Trong tab `Tùy chọn` | Bảng mặc định hết cuộn thừa |
| Thanh đánh giá (`EvalBar`) | 18 px dọc bên trái bàn cờ | 24 px dọc bên trái bàn cờ; điểm nằm trong chip cách mép ≥ 4 px, tự lật đầu khi sát mép | 10 px ngang trên bàn cờ | Cập nhật theo nước đang xem / phân tích trực tiếp |
| Biểu ngữ xem lại (`Đang xem lại nước N/M`) | Đè lên nhãn cột `1..9` ở live review | Đặt phía trên khung bàn cờ ở mọi bố cục (cả live review lẫn archive) | Trên khung bàn cờ / ẩn khi không cần | Không bao giờ che nhãn cột/hàng |
| Bảng **Phân tích** (`AnalysisPanel`) | Xếp chồng chung với bảng mặc định trong `#side-panel` | **Hoán đổi toàn bộ nội dung bảng bên** (gỡ bảng mặc định khỏi bố cục, giữ nguyên trạng thái cuộn & `viewPly`); nút `← Về ván` / `Esc` quay lại | Tab `Phân tích` trong Bottom Sheet ở trạng thái `full` | Gồm 7 khối A–G (Header, Nhận định, Chất lượng nước, 6 ply tiếp theo + `Sâu hơn`, Biểu đồ, Tóm tắt, Chạy phân tích trực tiếp / cả ván) |

## 2. Ma trận hiển thị nút Phân tích (`js/app/panelPolicy.js`)

| Chế độ (`mode`) | Biến thể (`variant`) | Trạng thái (`status` / `isArchive`) | Hiện nút **Phân tích**? | Deep link `#/play/.../review?analyze=1` |
|---|---|---|---|---|
| `local` | `xiangqi` | Đang chơi (`live`) | **CÓ** (ngoại lệ hai người dùng chung máy) | **Cho phép** |
| `local` | `jieqi` | Đang chơi (`live`) | **ẨN** (ghi chú trong menu **⋯**: *"Cờ Úp chưa hỗ trợ phân tích"*) | Chặn (thông báo chưa hỗ trợ) |
| `ai` | `xiangqi` / `jieqi` | Đang chơi (`live`) | **ẨN** | **CHẶN** (khi `unfinished`) |
| `online` | `xiangqi` / `jieqi` | Đang chơi (`live`) | **ẨN** | **CHẶN** (khi `unfinished`) |
| Bất kỳ (`local`/`ai`/`online`/archive) | `xiangqi` | Đã kết thúc hoặc Archive/Share | **CÓ** | **Cho phép** |
| Bất kỳ | `jieqi` | Đã kết thúc hoặc Archive/Share | **ẨN** | Chặn (thông báo chưa hỗ trợ) |

## 3. Các selector test cũ cần cập nhật (sẽ ghi đầy đủ khi hoàn tất Phase 2–4)
- Các selector đã cập nhật trong bộ test Playwright hiện có (Phase 4):
  - `tools/verify.py`: `button[data-action='undo']` → `[data-pact="undo"]` (local) / `Control+z` (AI); `flip`/`theme`/`hint` → `[data-testid="panel-menu-btn"]` + `[data-mitem="..."]`; `new` → phím `n`; `[data-pside='black']` → `[data-mitem="ai_config"]` + `[data-cside="black"]`; `resign` → `[data-pact="resign"]`.
  - `tools/verify_fx.py`: `button[data-action='undo']` → `[data-pact="undo"]`.
  - `tools/verify_jieqi.py`: `[data-action="hint"]` → `[data-testid="panel-menu-btn"]` + `[data-mitem="hint"]`.
  - `tools/verify_saves.py`: `[data-action="resign"]` → `[data-pact="resign"]`; `[data-online-act="resign"]` → `[data-pact="online-resign"]`; `[data-action="save-export"]` → `[data-testid="panel-menu-btn"]` + `[data-mitem="export"]`.
  - `tools/verify_engine.py`: `[data-engine='pikafish']` & `[data-pside='black']` → `[data-testid="panel-menu-btn"]` + `[data-mitem="ai_config"]`; `undo`/`new` → `Control+z` / `n`.
  - `tools/verify_races.py`: `undo`/`new` → `Control+z` / `n`; `resign` → `[data-pact="resign"]`.
  - `tools/verify_analysis.py`: cập nhật theo ma trận P4 (live AI ẩn nút Phân tích, unfinished AI archive chặn phân tích, Cờ Úp hiện ghi chú trong menu `⋯`, export qua `[data-mitem="export"]`, kiểm tra `offsetParent === null`).
  - `tools/verify_mobile.py` & `tools/verify_touch.py`: `[data-action="resign"]` → `[data-pact="resign"]`; T12 kiểm tra clipboard fallback trên ván AI đã kết thúc.

## 5. Tự đánh giá trực quan (Visual Self-Evaluation — Round 3 Final)
- **R1 (Clarity & Hierarchy)**: **5/5** — Bàn cờ nổi bật, bảng gọn chỉ còn tiêu đề + 2 thẻ người chơi + danh sách nước đi + 1 dòng trạng thái + hàng nút đáy.
- **R2 (Fit & Scroll Discipline)**: **5/5** — Không cuộn toàn bảng (`scrollH === clientH`), danh sách nước đi là vùng cuộn duy nhất, chân bảng không bị cắt mép.
- **R3 (Full-Swap Analysis)**: **5/5** — Thanh `← Về ván | Phân tích | Pikafish | ⋯` cố định, nhận định 5 mức, chất lượng nước đi, phương án 6 nước, biểu đồ, vòng độ chính xác rõ ràng.
- **R4 (Board Overlays & Eval Bar)**: **5/5** — Banner xem lại neo trên khung bàn cờ (`bannerBottom 60 <= svgTop 62`), thanh đánh giá `24 px`, mũi tên sai lầm không đè nhau.
- **R5 (Phone & Landscape)**: **5/5** — `390×844` và `844×390` không tràn ngang, không đè chữ, không lặp nút.
- **R6 (Dual Themes)**: **5/5** — Cả **Gỗ Lim** và **Ngọc Bích** đồng nhất, độ tương phản cao (`>= 11.29`).
