# Định dạng Lưu, Xuất & Nhập Ván Cờ (`v = 1`)

Tài liệu đặc tả định dạng lưu trữ chuẩn cho cả **Cờ Tướng (`xiangqi`)** và **Cờ Úp (`jieqi`)**, dùng chung giữa trình duyệt và kiểm thử Node (`js/storage/`).

## 1. Bản ghi chuẩn JSON (`.xqgame.json`)

```json
{
  "v": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "variant": "jieqi",
  "mode": "ai",
  "createdAt": "2026-11-25T10:00:00.000Z",
  "updatedAt": "2026-11-25T10:05:12.000Z",
  "red": { "name": "Bạn", "kind": "human" },
  "black": { "name": "Máy", "kind": "engine", "level": "nghiep-du" },
  "tc": "nhanh",
  "start": {
    "fen": "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w - - 0 1 R2N2B2A2C2P5/r2n2b2a2c2p5"
  },
  "moves": [
    { "m": "a3a4", "r": "P" },
    { "m": "b7b0", "r": "C", "cr": "N" }
  ],
  "result": "unfinished",
  "reason": null,
  "note": "Khai cuộc thử nghiệm",
  "source": "manual"
}
```

- `moves[].m`: tọa độ ICCS 4 ký tự (`[a-i][0-9][a-i][0-9]`).
- `moves[].r` *(chỉ Cờ Úp)*: loại quân thật vừa lật khi quân úp di chuyển (`R | N | B | A | C | P`).
- `moves[].cr` *(chỉ Cờ Úp)*: loại quân thật của quân úp bị ăn (khi `REVEAL_ON_CAPTURE = true`).
- **Không bao giờ lưu**: `guestId`, địa chỉ IP, `secretLocal`, `_secret`, hoặc danh tính quân còn úp.

## 2. Văn bản dạng PGN (`.pgn` / `.txt`)

### Ngữ pháp
- Khối tiêu đề: mỗi dòng `[HeaderName "Value"]` (cho phép tiêu đề lạ, tự bỏ qua).
  - Bắt buộc/chuẩn: `[Game "Xiangqi" | "Jieqi"]`, `[Red "..."]`, `[Black "..."]`, `[Date "YYYY.MM.DD"]`, `[Result "1-0" | "0-1" | "1/2-1/2" | "*"]`, `[Termination "..."]`, `[FEN "..."]` (nếu không phải thế ban đầu), `[TimeControl "..."]`.
- Khối nước đi: đánh số `1. <đỏ> <đen> 2. ...` kết thúc bằng kết quả (`1-0`, `0-1`, `1/2-1/2`, hoặc `*`).
  - Trong Cờ Úp, nước lật gắn `=<R|N|B|A|C|P>`, ăn quân úp gắn `x=<R|N|B|A|C|P>`, ví dụ: `1. a3a4=P b7b0=Cx=N *`.

### Ví dụ Cờ Tướng
```pgn
[Game "Xiangqi"]
[Red "Bạn"]
[Black "Máy"]
[Date "2026.11.25"]
[Result "1-0"]
[Termination "resign"]

1. h2e2 h9g7 2. h0g2 i9h9 1-0
```

### Ví dụ Cờ Úp
```pgn
[Game "Jieqi"]
[Red "Đỏ"]
[Black "Đen"]
[Date "2026.11.25"]
[Result "*"]

1. a3a4=P a6a5=R 2. h2e2=C h7e7=N *
```

## 3. Liên kết chia sẻ (`#/replay?g=<payload>`)

- Bản ghi rút gọn (bỏ `id`, `note`, `createdAt`, `updatedAt`) được nén bằng `CompressionStream('deflate-raw')` (tiền tố `z.`, hoặc `r.` nếu không nén) rồi mã hóa `base64url`.
- Giới hạn độ dài liên kết: tối đa `6000` ký tự (nếu dài hơn, giao diện gợi ý tải file `.xqgame.json`).
- Bộ giải mã áp giới hạn cứng `256 KB` dữ liệu sau giải nén để chống zip bomb.

## 4. Chính sách bí mật Cờ Úp & Giới hạn kiểm định

- **Xuất / Chia sẻ**: chỉ chứa dữ liệu **công khai** (các quân đã lật). Hai ván có cùng lịch sử công khai nhưng khác quân còn úp sẽ xuất ra file giống nhau từng byte.
- **Chơi tiếp ván Cờ Úp đã nhập**: hàm `dealRemainingPool(board, pool, rng)` chia ngẫu nhiên đều (`crypto.getRandomValues`) các quân còn lại trong pool vào các ô đang úp mà không làm đổi `publicFen()`.
- **Tự động lưu (Autosave) nội bộ**: lưu `secretLocal` riêng trong kho IndexedDB cục bộ để khôi phục chính xác ván đang chơi dở; mọi hàm xuất (`toJson`, `toPgn`, `encodeSharePayload`) đều loại bỏ trường này. Ván online **không** autosave (máy chủ là nguồn sự thật).
- **Giới hạn**: kích thước file `<= 256 KB`, tối đa `1000` nửa nước (plies), tên `<= 16` ký tự, ghi chú `<= 200` ký tự, chặn các khóa `__proto__` / `constructor` / `prototype`, và **phát lại toàn bộ nước đi** qua `XiangqiRules` / `JieqiRules` khi nhập.
