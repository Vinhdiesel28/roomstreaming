# Watchroom

Watchroom là một MVP watch party miễn phí: tạo phòng tạm thời, xem video YouTube đồng bộ, dùng hàng chờ chung, chat chữ và voice chat theo thời gian thực.

## Quyết định phạm vi

- Không tài khoản.
- Không lưu tin nhắn chat.
- Không lưu lịch sử phòng.
- Trạng thái phòng chỉ nằm trong RAM của backend và mất khi backend restart.
- Mỗi phòng tối đa 20 người, 50 video trong hàng chờ.
- Host được nhận lại quyền nếu reconnect trong 60 giây; sau đó quyền chuyển cho thành viên online lâu nhất.
- Video được nhúng trực tiếp bằng YouTube IFrame API. Backend không tải, proxy hay lưu video.
- Có thể dán link hoặc tìm video trong phòng. Tìm kiếm dùng YouTube Data API v3 qua backend để không lộ API key trong bundle frontend.
- Voice chat dùng WebRTC audio, tối đa 8 người. Âm thanh đi trực tiếp giữa các trình duyệt; backend chỉ chuyển tín hiệu kết nối và không ghi âm.

Thiết kế này cố ý bỏ MongoDB để giảm độ phức tạp và giữ chi phí bằng 0. Trên Render Free, một phòng đang hoạt động tiếp tục giữ backend thức nhờ lưu lượng WebSocket; phòng không hoạt động không cần tồn tại lâu dài.

## Chạy local

Yêu cầu Node.js 22 trở lên.

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Health check: `http://localhost:3001/health`

Backend tự đọc file `.env` ở thư mục gốc khi khởi động. Sau khi sửa `.env`, cần dừng và chạy lại `npm run dev`.

Không đặt key thật vào `.env.example` vì file đó được phép commit. Nếu đã từng push key lên GitHub, hãy thu hồi key cũ và tạo key mới trong Google Cloud.

Khi chạy PowerShell, cũng có thể đặt biến tạm cho tiến trình:

```powershell
$env:SESSION_SECRET="mot-chuoi-ngau-nhien-it-nhat-32-ky-tu"
$env:ALLOWED_ORIGINS="http://localhost:5173"
$env:YOUTUBE_API_KEY="api-key-tu-google-cloud"
npm run dev
```

### Bật tìm kiếm YouTube miễn phí

1. Tạo một project trong Google Cloud Console.
2. Bật **YouTube Data API v3**.
3. Tạo API key trong **APIs & Services > Credentials**.
4. Giới hạn key chỉ được gọi **YouTube Data API v3**.
5. Đặt key vào biến môi trường `YOUTUBE_API_KEY` của backend rồi khởi động lại.

Nếu chưa đặt key hoặc hết quota tìm kiếm trong ngày, chức năng dán link và phát video vẫn hoạt động bình thường. Backend cache cùng một từ khóa trong 5 phút và giới hạn 10 lượt/phút/IP để tiết kiệm quota.

### Voice chat local

1. Mở cùng một phòng bằng hai trình duyệt hoặc hai thiết bị.
2. Mỗi bên bấm **Tham gia voice** và cho phép truy cập micro.
3. Thử **Tắt mic**, **Bật mic** và **Rời voice**.

`localhost` được trình duyệt coi là môi trường an toàn. Khi public, trang bắt buộc dùng HTTPS để xin quyền micro. Cấu hình STUN mặc định đủ cho nhiều mạng gia đình; một số mạng công ty, mạng di động hoặc NAT hạn chế cần TURN relay.

Để thử TURN local, tạo `apps/web/.env.local`:

```dotenv
VITE_TURN_URL=turn:relay.example.com:3478
VITE_TURN_USERNAME=watchroom
VITE_TURN_CREDENTIAL=replace-me
```

Không có TURN thì voice vẫn hoạt động trên phần lớn mạng thông thường, nhưng không thể bảo đảm 100% cặp thiết bị kết nối được.

## Kiểm tra

```bash
npm run typecheck
npm test
npm run build
```

Khi API đang chạy, kiểm tra signaling voice bằng hai Socket.IO client tự động:

```bash
npm run test:voice
```

## Deploy miễn phí

### Cả web và API trên Render

1. Push repo lên GitHub.
2. Trong Render, tạo Blueprint từ `render.yaml`.
3. Blueprint tạo `roomstreaming-web` (Static Site) và `roomstreaming-api` (Web Service).
4. Điền `VITE_API_URL` bằng URL API có `https://`, ví dụ `https://roomstreaming-api.onrender.com`.
5. Điền `ALLOWED_ORIGINS` bằng URL frontend chính xác, ví dụ `https://roomstreaming-web.onrender.com`.
6. Điền `YOUTUBE_API_KEY` bằng key đã tạo ở Google Cloud.
7. Có thể để trống ba biến `VITE_TURN_*`; chỉ điền nếu đã có dịch vụ TURN.
8. Render tự sinh `SESSION_SECRET`. Sau khi biết URL chính xác, redeploy cả hai service nếu đã đổi biến môi trường.

Static Site có HTTPS sẵn. Web Service miễn phí có thể ngủ khi không hoạt động và cần một lúc để thức lại; trạng thái phòng trong RAM sẽ mất nếu backend restart hoặc sleep.

### Phương án khác: Web trên Cloudflare Pages

- Root directory: `/`
- Build command: `npm ci && npm run build -w @roomstreaming/web`
- Output directory: `apps/web/dist`
- Environment variable: `VITE_API_URL=https://ten-api.onrender.com`
- Optional TURN variables: `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`

Thêm SPA fallback để `/room/ABCD2345` trả về `index.html`. Nếu dùng Pages Direct Upload, đặt file `_redirects` trong `apps/web/public`.

## Giao thức realtime chính

Client gửi:

- `room:create`, `room:join`, `room:leave`
- `queue:add`, `queue:remove`
- `playback:command`
- `chat:send`
- `voice:join`, `voice:leave`, `voice:mute`, `voice:signal`

Server phát:

- `room:snapshot`
- `chat:created`
- `member:joined`, `member:left`
- `host:changed`, `app:error`
- `voice:peer-joined`, `voice:peer-left`, `voice:peer-muted`, `voice:signal`

Chat chỉ được broadcast qua Socket.IO. Nó không nằm trong `RoomStore` và không thể lấy lại sau khi refresh.
Voice chat cũng không được lưu hoặc ghi âm. Registry voice chỉ nằm trong RAM và được xóa khi socket rời phòng hoặc mất kết nối.
