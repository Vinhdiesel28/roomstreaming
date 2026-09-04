# Watchroom

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FVinhdiesel28%2Froomstreaming)

Watchroom là một MVP watch party miễn phí: tạo phòng tạm thời, xem video YouTube đồng bộ, dùng hàng chờ chung, chat chữ và voice chat theo thời gian thực.

## Quyết định phạm vi

- Không tài khoản.
- Không lưu tin nhắn chat.
- Không lưu lịch sử phòng.
- Trạng thái chính nằm trong RAM; mỗi tab đang ở phòng giữ một bản khôi phục tạm trong `sessionStorage` (không gồm chat) để dựng lại đúng mã phòng sau khi backend restart.
- Mỗi phòng tối đa 20 người, 50 video trong hàng chờ.
- Host được nhận lại quyền nếu reconnect trong 60 giây; sau đó quyền chuyển cho thành viên online lâu nhất.
- Video được nhúng trực tiếp bằng YouTube IFrame API. Backend không tải, proxy hay lưu video.
- Có thể dán link hoặc tìm video trong phòng. Tìm kiếm dùng YouTube Data API v3 qua backend để không lộ API key trong bundle frontend.
- Bộ đề xuất chỉ giữ tối đa 5 video vừa phát và các video bị bỏ qua/xóa trong RAM của phòng; không gắn dữ liệu này với tài khoản hay lưu dài hạn.
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
$env:LASTFM_API_KEY="api-key-tu-lastfm"
npm run dev
```

### Bật tìm kiếm YouTube miễn phí

1. Tạo một project trong Google Cloud Console.
2. Bật **YouTube Data API v3**.
3. Tạo API key trong **APIs & Services > Credentials**.
4. Giới hạn key chỉ được gọi **YouTube Data API v3**.
5. Đặt key vào biến môi trường `YOUTUBE_API_KEY` của backend rồi khởi động lại.

Nếu chưa đặt key hoặc hết quota tìm kiếm trong ngày, chức năng dán link và phát video vẫn hoạt động bình thường. Backend cache cùng một từ khóa trong 5 phút và giới hạn 10 lượt/phút/IP để tiết kiệm quota.

### Bật đề xuất nhạc khác nghệ sĩ

1. Tạo API account tại [Last.fm](https://www.last.fm/api/account/create).
2. Đặt API key nhận được vào `LASTFM_API_KEY` của backend.
3. Khởi động lại backend; `/health` sẽ trả `"musicRecommendations": true`.

Khi có key, backend tách ca sĩ và tên bài từ video đang phát cùng tối đa 5 bài gần đây, lấy các bài tương tự từ Last.fm, ánh xạ chúng sang video YouTube có thể nhúng rồi xếp hạng theo độ khớp, thời lượng và độ phổ biến. Các bản official/VEVO/Topic được ưu tiên; live, lyrics, cover và karaoke bị hạ điểm, còn nhiều phiên bản của cùng một bài được gộp lại. Video bị bỏ qua, bị xóa hoặc đã nằm trong hàng chờ sẽ không được đề xuất lại. Kết quả được cache 6 giờ. Nếu Last.fm lỗi hoặc chưa có key, danh sách cùng kênh vẫn hoạt động như trước. Không có tên người dùng, chat hay lịch sử phòng nào được gửi tới Last.fm.

### Bật gợi ý từ Invidious (tùy chọn)

1. Chuẩn bị một instance Invidious do bạn quản lý hoặc được phép dùng API. URL GitHub không phải instance; không tự động sử dụng server công cộng của người khác.
2. Trên Render, vào **roomstreaming-api > Environment**, thêm `INVIDIOUS_API_URL` là URL gốc của instance, ví dụ `https://invidious.example.com` (đây là ví dụ, cần thay bằng server thật). Không thêm `/api/v1`, query string hoặc thông tin đăng nhập vào URL. Ưu tiên HTTPS.
3. Giữ `YOUTUBE_API_KEY`: backend vẫn dùng YouTube để kiểm tra thông tin, thời lượng và quyền nhúng. `LASTFM_API_KEY` vẫn là nguồn bổ sung nếu có.
4. Deploy lại **backend**. `/health` có `features.invidiousRecommendationsConfigured: true` khi đã nhập biến; cờ này chỉ xác nhận cấu hình, không xác nhận instance đang hoạt động.

Backend gọi `/api/v1/videos/:id` và lấy `recommendedVideos` theo video nguồn mà frontend đang yêu cầu. Danh sách Invidious được ưu tiên trước nguồn Last.fm và video cùng kênh, sau đó đi qua bộ lọc gộp bản trùng, xen kẽ nghệ sĩ, bỏ ID đã nghe/bỏ qua hoặc đang chờ. Chỉ nhận ứng viên Invidious đã xác minh cho nhúng, có thời lượng từ 90 giây đến 20 phút. Player, hàng chờ và thời điểm frontend tải lại đề xuất không thay đổi.

Request Invidious có timeout 3 giây, cache 30 phút và gộp các request đồng thời. Khi instance lỗi, backend tạm ngừng gọi 60 giây và dùng nguồn cũ; kết quả dự phòng chỉ cache 60 giây để có thể thử lại sớm. Để trống `INVIDIOUS_API_URL` sẽ tắt tích hợp. Backend chỉ gửi ID video nguồn cùng ngôn ngữ/vùng tới instance, không gửi tên người dùng, chat, mã phòng hay lịch sử nghe.

Bạn có thể tự kiểm tra bằng cách chọn một video, xem danh sách gợi ý rồi thêm một bài vào hàng chờ để kiểm tra lọc trùng. Thử tạm đặt URL instance không hoạt động và restart backend: phòng/player vẫn hoạt động, gợi ý dùng nguồn cũ và log xuất hiện cảnh báo `Invidious unavailable`. Khôi phục URL sau khi thử. Không proxy luồng video qua Invidious.

API tham khảo: https://docs.invidious.io/api/#get-apiv1videosid

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
7. Điền `LASTFM_API_KEY` bằng API key từ Last.fm để bật gợi ý nhạc khác nghệ sĩ. Nếu để trống, web vẫn dùng video mới cùng kênh.
8. Có thể để trống ba biến `VITE_TURN_*`; chỉ điền nếu đã có dịch vụ TURN.
9. Render tự sinh `SESSION_SECRET`. Sau khi biết URL chính xác, redeploy cả hai service nếu đã đổi biến môi trường.

Static Site có HTTPS sẵn. Web Service miễn phí có thể ngủ khi không hoạt động và cần một lúc để thức lại. Trong lúc đó web hiện màn hình chờ và tự kết nối lại. Nếu RAM backend bị xóa, tab quay lại đầu tiên dùng bản tạm trong `sessionStorage` để khôi phục mã phòng, video đang phát và hàng chờ. Nếu chỉ còn link mời mà không còn bản tạm, link vẫn tạo lại một phòng trống với cùng mã; người vào đầu tiên trở thành Host. Chat và voice không được khôi phục.

### Phương án khác: Web trên Cloudflare Pages

- Root directory: `/`
- Build command: `npm ci && npm run build -w @roomstreaming/web`
- Output directory: `apps/web/dist`
- Environment variable: `VITE_API_URL=https://ten-api.onrender.com`
- Optional TURN variables: `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`

Thêm SPA fallback để `/room/ABCD2345` trả về `index.html`. Nếu dùng Pages Direct Upload, đặt file `_redirects` trong `apps/web/public`.

## Giao thức realtime chính

Client gửi:

- `room:create`, `room:join`, `room:resume`, `room:leave`
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
