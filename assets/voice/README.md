# Giọng nói tiếng Trung (`assets/voice/`)

Thư mục này chứa các file thoại tiếng Trung phong cách tướng quân cổ đại (`*.mp3`) và tệp cấu hình [manifest.json](manifest.json) để trò chơi chạy hoàn toàn offline.

## Danh sách file thoại

| Sự kiện | File | Chữ hiển thị | Pinyin | Ghi chú |
|---|---|---|---|---|
| `start` | `start_1.mp3` | 請 | qǐng | Phát khi bắt đầu ván mới |
| `capture` | `capture_1.mp3`, `capture_2.mp3` | 吃 / 殺 | chī / shā | Chọn ngẫu nhiên khi ăn quân |
| `check` | `check_1.mp3` | 將軍 | jiāng jūn | Phát khi chiếu tướng |
| `checkmate` | `checkmate_1.mp3`, `checkmate_2.mp3` | 將死 / 承讓 | jiāng sǐ / chéng ràng | Chiếu bí, sau đó 承讓 |
| `draw` | `draw_1.mp3` | 和棋 | hé qí | Phát khi hòa cờ |

## Tạo lại giọng nói với giọng / cao độ / tốc độ khác

Dùng script `tools/gen_voice.py` (cần kết nối mạng một lần khi tạo file):

```powershell
python tools/gen_voice.py --voice zh-CN-YunjianNeural --pitch -35Hz --rate -15%
```

Bạn có thể mở trang nghe thử **http://localhost:8000/?voices** để so sánh các giọng ứng viên (`zh-CN-YunjianNeural`, `zh-CN-YunzeNeural`, `zh-CN-YunyangNeural`, `zh-CN-YunxiNeural`) ở 3 mức pitch/rate rồi chạy lại lệnh trên với tham số ưng ý (thêm `--skip-audition` nếu không cần tạo lại các bản nghe thử).

## Thay thế bằng bản thu âm của riêng bạn

Chỉ cần ghi đè các file cùng tên (`start_1.mp3`, `capture_1.mp3`, `capture_2.mp3`, `check_1.mp3`, `checkmate_1.mp3`, `checkmate_2.mp3`, `draw_1.mp3`) trong thư mục `assets/voice/` (hoặc đổi tên/thêm biến thể rồi cập nhật `assets/voice/manifest.json`). Trò chơi tự động chuẩn hóa độ lớn RMS (hoặc dùng trường `"gain"` trong `manifest.json`) và xử lý hiệu ứng vang + EQ ngay trong trình duyệt.

## Lưu ý bản quyền & điều khoản sử dụng

Các file mặc định được tạo bằng `edge-tts` (gọi không chính thức dịch vụ đọc trực tuyến của Microsoft). Phù hợp cho mục đích cá nhân / thử nghiệm cục bộ; nếu phân phối rộng rãi hoặc thương mại hóa, hãy thay thế các file trong thư mục này bằng giọng có giấy phép hợp lệ hoặc bản thu âm tự thực hiện.
