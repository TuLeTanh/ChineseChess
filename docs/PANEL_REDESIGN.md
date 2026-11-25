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
- Các test thao tác trực tiếp trên nút `Ván mới`, `Xoay bàn`, `Giao diện`, `Gợi ý`, `Lưu / Xuất`, `Đổi cấp độ/engine` trên mặt bảng bên sẽ mở menu **⋯** (`[data-testid="panel-menu-btn"]`) trước hoặc dùng phím tắt (`N`, `F`, `M`, `V`, `Ctrl+Z`). Danh sách chi tiết sẽ được cập nhật ở cuối Phase 4.
