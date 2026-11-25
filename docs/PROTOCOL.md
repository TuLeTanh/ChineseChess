# Online WebSocket Protocol (`v = 1`)

Endpoint: `ws://<host>:<port>/ws` (hoặc `wss://` sau TLS).  
Mọi khung dữ liệu đều là JSON, kích thước tối đa `4096` byte, tắt `perMessageDeflate`.  
Mọi gói tin từ server đều kèm phiên bản `v: 1` và số thứ tự đơn điệu tăng `n`.

## 1. Handshake & Heartbeat

- **Client → Server `hello`**: `{ v: 1, type: "hello", guestId, nickname, protocolVersion: 1 }`
- **Server → Client `welcome`**: `{ v: 1, n, type: "welcome", guestId, nickname, onlineCount }`
- Nếu `guestId` đang thuộc một ván chưa kết thúc, server tự động gửi thêm **`game.state`** để đồng bộ lại toàn bộ bàn cờ, đồng hồ và danh sách nước đi, đồng thời gửi **`opponent.reconnected`** cho đối thủ.
- **Client → Server `ping`**: `{ v: 1, type: "ping", t }` → **Server `pong`**: `{ v: 1, n, type: "pong", t, onlineCount }`.

## 2. Ghép trận nhanh (Quick Match)

- `queue.join`: `{ variant: "cotuong" | "coup", tc: "chop" | "nhanh" | "cham" | "none" }`
- `queue.joined` / `queue.leave` / `queue.left` / `queue.timeout` (sau 120 giây).
- Khi ghép được 2 `guestId` khác nhau, server tạo ván và gửi **`game.start`** cho cả hai bên.

## 3. Phòng riêng (Private Room)

- `room.create`: `{ variant, tc, side: "red" | "black" | "random" }` → `room.created` (mã 6 ký tự từ `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, TTL 10 phút).
- `room.join`: `{ code }` → `room.joined` (cho khách) + `room.update` (cho chủ phòng).
- `room.start`: `{ code }` (chỉ chủ phòng khi đã có khách) → `game.start` cho cả hai.
- `room.leave` → `room.left` / `room.closed`.

## 4. Trong ván đấu

- `game.start` / `game.state`: `{ gameId, variant, tc, mySide, sideToMove, fen, pool, ply, moves, clocks, players, opponentConnected, over, result }`.
  - **Cờ Úp**: server giữ `_secret` hoàn toàn phía server; `fen` là public FEN (`X`/`x` cho quân úp) và `pool` là số quân úp còn lại. Không bao giờ gửi thông tin quân chưa lật qua mạng.
- `game.move` (C→S): `{ gameId, move }` (ICCS 4 ký tự, ví dụ `"h2e2"`).
- `game.move` (S→C): `{ gameId, ply, move, side, fen, pool, reveal, capturedReveal, suffix, gaveCheck, isCheckmate, sideToMove, clocks }`.
- `game.resign`, `game.draw.offer` (tối đa 1 lần mỗi 10 ply, tự hủy khi có nước mới), `game.draw.respond` (`{ accept }`), `game.rematch` (tái đấu đổi màu).
- `game.over`: `{ gameId, winner: "red" | "black" | null, reason, clocks, ply }`.
  - `reason`: `checkmate | stalemate | timeout | resign | abandon | draw_agreement | draw_repetition | draw_no_capture`.

## 5. Giới hạn & Bảo mật

- Tối đa `20` tin nhắn/giây mỗi kết nối; `5` lỗi giao thức trong 10 giây → đóng kết nối với mã `1008`.
- Tối đa `3` kết nối mới/IP/giây, `500` kết nối đồng thời, `200` phòng chờ.
- Kiểm tra `Origin` khi nâng cấp WebSocket và whitelist file tĩnh nghiêm ngặt.
