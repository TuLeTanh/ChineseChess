# Ghi nước đi kiểu truyền thống (Vietnamese Traditional Notation)

## 1. Where moves are shown (Phase A Audit)

Mọi vị trí hiển thị nước đi hoặc dùng chuỗi nước đi làm nhãn/tooltip trong ứng dụng:

| Vị trí | File & dòng | Selector / Phần tử | Ghi chú |
|---|---|---|---|
| Danh sách nước đi (desktop & bottom sheet) | `js/ui/sidePanel.js` (`_buildChipHtml`) | `button.move-chip[data-ply] .move-text`, `title`, `aria-label` | Kèm biểu tượng quân, `×` ăn quân, `LẬT`, chấm chiếu; luôn giữ `data-move="<iccs>"` |
| Tooltip thanh thời gian (timeline) | `js/ui/sidePanel.js` (`showTip`) | `.timeline-tooltip` | Hiện `"nước N: <move>"` khi rê/kéo trên `.move-timeline` |
| Dải nước đi điện thoại (horizontal strip) | `js/ui/moveStrip.js` (`update`) | `button.mstrip-chip[data-ply] .mstrip-iccs` | Dải cuộn ngang ở bố cục dọc `stack`; luôn giữ `data-move="<iccs>"` |
| Phân tích — Thẻ chất lượng nước đi | `js/ui/analysisView.js` (`_renderQuality`) | `[data-testid="an-quality-card"] .an-quality-mv`, `.an-quality-desc` | Hiển thị `"Nước N: <main> (<other>)"` và `"Nước tốt hơn: <main> (<other>)"` |
| Phân tích — Phương án tiếp theo (PV 6/8 nước) | `js/ui/analysisView.js` (`_renderNextMoves`) | `.an-pv-chip` | Replay bằng `formatLine()`; kèm `data-move="<iccs>"` và `title` |
| Phân tích — Hàng "Nước đã đi" | `js/ui/analysisView.js` (`_renderNextMoves`) | `[data-testid="an-played-row"]` | Hiển thị `"Nước đã đi: <main> (<other>)"` |
| Phân tích — Danh sách "Sai lầm lớn nhất" | `js/ui/analysisView.js` (`_renderSummary`) | `button.an-mistake-item[data-jump-ply]` | Hiển thị `"Nước N (Đỏ/Đen): <main> (<other>)"` |
| Thư viện ván & Xem lại | `js/screens/libraryScreen.js`, `js/screens/replayScreen.js` | Dùng chung `SidePanel`, `MoveStrip`, `AnalysisPanel` | `libraryScreen.js` chỉ hiện số nước đi (`N nước`), không in chuỗi nước |
| Bàn cờ (nhãn mũi tên / gợi ý / toast) | `js/ui/boardView.js` | Chỉ vẽ mũi tên SVG không có chữ nước đi; review banner chỉ hiện `N/M` | Không hiển thị chuỗi ICCS |

### Các test hiện có đọc text nước đi (cần lưu ý hồi quy)
- `tools/verify.py`:
  - Dòng 143: `assert page.locator(".move-row .col-red").first.text_content() == "h2e2"` → kiểm tra `data-move="h2e2"` (hoặc bật chế độ `coord`).
  - Dòng 161: `assert page.locator(".move-row .col-red").nth(3).text_content() == "e2e6+"` → kiểm tra `data-move="e2e6"` + class `.is-check`.
  - Dòng 297: `assert page.locator(".move-row .col-red").first.text_content() == "b7b9#"` → kiểm tra `data-move="b7b9"` + class `.is-checkmate`.
  - Dòng 495, 538: kiểm tra `textContent.trim().length >= 4` (vẫn đúng với cả kiểu truyền thống lẫn tọa độ).
- `tools/verify_analysis.py`:
  - Dòng 211/241: kiểm tra `"h0h7"` trong `[data-testid="an-quality-card"]` — vẫn thỏa vì thẻ phân tích hiển thị dạng `"Xe 2 tiến 7 (h0h7)"` (cả hai dạng).
- `tools/verify_engine.py`:
  - Dòng 497, 525, 532: kiểm tra `textContent.trim().length >= 4` (tương thích cả hai chế độ).

*(Các mục quy tắc, bảng chuẩn, Cờ Úp và hướng dẫn tùy biến sẽ được hoàn thiện ở Phase C7.)*
