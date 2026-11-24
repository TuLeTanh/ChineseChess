# Pikafish Engine (`engine/`)

Thư mục này chứa tệp thực thi **Pikafish** (`Pikafish-2026-09-06`, bản CPU `Pikafish-Windows-x86-64-universal`) và mạng nơ-ron NNUE (`engine/dist/pikafish.nnue`) dùng cho chế độ **Đấu máy** qua cầu nối cục bộ `tools/server.py`.

## Nguồn tải
- Phát hành chính thức: [official-pikafish/Pikafish Releases](https://github.com/official-pikafish/Pikafish/releases)
- Cài đặt / cập nhật tự động:
  ```powershell
  python tools/setup_engine.py
  ```

## Tóm tắt bản quyền (GPL v3 & NNUE)
- **Mã nguồn & tệp thực thi Pikafish**: phát hành theo **GNU General Public License v3.0 (GPL v3)** (xem [LICENSE](LICENSE)). Nếu phân phối trò chơi kèm tệp thực thi Pikafish, bạn bắt buộc phải đi kèm bản sao giấy phép GPL v3 và mã nguồn (hoặc đường dẫn tới mã nguồn tương ứng).
- **Mạng nơ-ron `pikafish.nnue`**: tuân theo điều khoản riêng của dự án Pikafish — **không sử dụng cho mục đích thương mại khi chưa có sự cho phép**.
- Các tệp nhị phân (`*.exe`, `*.nnue`, `*.zip`, `*.7z`) đã được đưa vào `.gitignore` và không commit vào kho mã nguồn.

## Cấu hình hiện tại (`engine/engine.json`)
- Tệp thực thi: `engine/dist/Pikafish-Windows-x86-64-universal.exe`
- Mạng NNUE: `engine/dist/pikafish.nnue`
