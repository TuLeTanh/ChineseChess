# Hướng dẫn Triển khai Online Server (Deploy)

Máy chủ online (`server/index.js`) phục vụ đồng thời giao diện tĩnh (`index.html`, `css/`, `js/`, `assets/`), API kiểm tra trạng thái (`GET /api/online/info`) và WebSocket (`/ws`) trên **một cổng duy nhất** (mặc định `8787`).

## 1. Chạy cục bộ (Local & LAN)

```bash
cd server
npm install
cd ..
node server/index.js
```

Mở trình duyệt tại `http://127.0.0.1:8787`.

Để chơi qua mạng LAN (ví dụ điện thoại hoặc máy khác trong cùng Wi-Fi):

```bash
node server/index.js --lan
```

Sau đó truy cập `http://<IP-LAN-của-bạn>:8787` (ví dụ `http://192.168.1.25:8787`).

## 2. Chạy bằng Docker

```bash
docker build -t chinese-chess-online .
docker run -d --name chinese-chess -p 8787:8787 \
  -e ALLOWED_ORIGINS=https://chess.example.com \
  chinese-chess-online
```

## 3. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8787` | Cổng HTTP + WebSocket |
| `HOST` | `127.0.0.1` (`0.0.0.0` với `--lan`) | Địa chỉ lắng nghe |
| `ALLOWED_ORIGINS` | *(trống = localhost/same-host)* | Danh sách origin được phép (phân cách bằng dấu phẩy) |
| `TRUST_PROXY` | `0` | Đặt `1` khi chạy sau Nginx / Caddy / Cloudflare |
| `MAX_CONNECTIONS` | `500` | Giới hạn số kết nối WebSocket đồng thời |
| `MAX_ROOMS` | `200` | Giới hạn số phòng riêng chờ đồng thời |
| `ROOM_TTL_MS` | `600000` | Thời hạn phòng chờ (10 phút) |
| `RECONNECT_GRACE_MS` | `90000` | Thời gian chờ kết nối lại khi đứt mạng (90 giây) |

## 4. Triển khai miễn phí / PaaS (Fly.io, Railway, Render)

- **Fly.io**: `fly launch` với `Dockerfile` có sẵn; cấu hình `internal_port = 8787`, bật HTTPS (WSS tự động).
- **Render / Railway**: Chọn triển khai từ `Dockerfile`, đặt biến `ALLOWED_ORIGINS=https://<tên-miền-của-bạn>` và `TRUST_PROXY=1`.
- **Nginx Reverse Proxy** (trên VPS): chuyển tiếp `/ws` với `proxy_http_version 1.1`, `Upgrade`, `Connection "upgrade"`, và đặt `TRUST_PROXY=1`.
