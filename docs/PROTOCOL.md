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

- `game.start` / `game.state`: `{ gameId, variant, tc, mySide, sideToMove, fen, pool, ply, moves, clocks, players, opponentConnected, over, result, rematchOfferBy, opponentLeft, rematchDeclined }`.
  - **Cờ Úp**: server giữ `_secret` hoàn toàn phía server; `fen` là public FEN (`X`/`x` cho quân úp) và `pool` là số quân úp còn lại. Không bao giờ gửi thông tin quân chưa lật qua mạng.
  - Khi người chơi tải lại trang trong lúc lời mời tái đấu đang chờ, `hello` sẽ đồng bộ lại `game.state` kèm `rematchOfferBy` / `opponentLeft` / `rematchDeclined`.
- `game.move` (C→S): `{ gameId, move }` (ICCS 4 ký tự, ví dụ `"h2e2"`). Gửi nước đi với `gameId` cũ sau tái đấu sẽ bị từ chối.
- `game.move` (S→C): `{ gameId, ply, move, side, fen, pool, reveal, capturedReveal, suffix, gaveCheck, isCheckmate, sideToMove, clocks }`.
- `game.resign`, `game.draw.offer` (tối đa 1 lần mỗi 10 ply, tự hủy khi có nước mới), `game.draw.respond` (`{ accept }`).
- **Tái đấu (Rematch)**:
  - `game.rematch` (C→S): `{ gameId }` — gửi lời mời hoặc chấp nhận tái đấu (idempotent nếu bấm đúp; bấm đồng thời chỉ tạo đúng 1 ván mới, đổi màu quân, giữ nguyên biến thể và `tc`).
  - `game.rematch.offered` (S→C): `{ gameId, by }` — thông báo đối thủ muốn tái đấu (TTL mặc định 60 giây, tùy chỉnh qua `REMATCH_TTL_MS`).
  - `game.rematch.cancel` (C→S) → `game.rematch.canceled` (S→C) — người mời hủy lời mời.
  - `game.rematch.decline` (C→S) → `game.rematch.declined` (S→C) — đối thủ từ chối lời mời.
  - `game.rematch.expired` (S→C) — lời mời hết hạn sau TTL.
  - `game.leave` (C→S) → `opponent.left` (S→C) — thông báo cho đối thủ khi một bên rời ván đã kết thúc.
- `game.over`: `{ gameId, winner: "red" | "black" | null, reason, clocks, ply }`.
  - `reason`: `checkmate | stalemate | timeout | resign | abandon | draw_agreement | draw_repetition | draw_no_capture`.

## 5. Giới hạn & Bảo mật

- Tối đa `20` tin nhắn/giây mỗi kết nối; `5` lỗi giao thức trong 10 giây → đóng kết nối với mã `1008`.
- Tối đa `3` kết nối mới/IP/giây, `500` kết nối đồng thời, `200` phòng chờ.
- Kiểm tra `Origin` khi nâng cấp WebSocket và whitelist file tĩnh nghiêm ngặt.
