# Đặt cơm trưa văn phòng · BonBon

Web app để cả văn phòng chọn cơm trưa mỗi ngày: admin đăng menu, mọi người chọn món, app tổng hợp số lượng gửi quán và hiện mã VietQR để chuyển khoản cho admin.

- Giao diện: HTML/JS tĩnh, chạy trên **GitHub Pages**, cài được như app trên điện thoại (PWA)
- Dữ liệu và đăng nhập: **Firebase** (Firestore + Google Sign-in)
- Thông báo đẩy: **Firebase Cloud Messaging + Cloudflare Worker** (miễn phí, không cần thẻ): khi admin đăng / thêm món và 15 phút trước giờ chốt, kể cả khi app đã đóng

## Cài đặt

### 1. Tạo Firebase
1. https://console.firebase.google.com → **Add project**.
2. **Authentication → Sign-in method → Google → Enable**. Không bật thêm phương thức nào khác.
3. **Firestore Database → Create database** → vùng `asia-southeast1` → **production mode**.
4. **Project settings → Your apps → `</>`** → Register → copy `firebaseConfig` vào `config.js`.

### 2. Khai báo admin (bắt buộc làm TRƯỚC khi deploy rules)
Firestore → **Start collection** `admins` → **Document ID** = email Google của admin, viết thường (ví dụ `ten@gmail.com`) → thêm 1 field bất kỳ (ví dụ `role` = `admin`) → Save. Thêm admin khác thì tạo thêm document.

Email admin không còn nằm trong code nên người xem repo không thấy.

### 3. (Tuỳ chọn) Chỉ cho email công ty
Sửa cả hai chỗ cho trùng nhau: `ALLOWED_DOMAIN` trong `config.js` và `allowedDomain()` trong `firestore.rules`, ví dụ `bonbon.com.vn`.

### 4. Deploy rules
Firestore → tab **Rules** → dán toàn bộ nội dung `firestore.rules` → **Publish**. (Không cần gói Blaze.)

### 5. Đưa lên GitHub Pages
**Settings → Pages → Deploy from a branch → `main` / `(root)`**. Sau đó vào Firebase → **Authentication → Settings → Authorized domains** → thêm `<tên-github>.github.io`.

### 6. Thông báo đẩy (Cloudflare Worker, miễn phí)
Thông báo khi app đã đóng / khoá màn hình cần một server nhỏ giữ khoá bí mật. Thư mục `worker/` là server đó, chạy trên Cloudflare (gói Free).

1. Tạo tài khoản miễn phí tại https://dash.cloudflare.com/sign-up.
2. Firebase Console → **Project settings → Service accounts → Generate new private key** → tải file JSON về (KHÔNG commit, KHÔNG gửi ai; `.gitignore` đã chặn).
3. Trong thư mục dự án chạy:
   ```bash
   cd worker
   npm install
   npx wrangler login                 # mở trình duyệt đăng nhập Cloudflare
   npx wrangler deploy                # in ra địa chỉ https://bonbon-push.<tên>.workers.dev
   npx wrangler secret put FIREBASE_SA < ~/Downloads/<file-vừa-tải>.json
   ```
4. Dán địa chỉ Worker vào `PUSH_WORKER_URL` trong `config.js`, commit & push.
5. Trên điện thoại: mở app → bấm **chuông** → **Cho phép thông báo** → **Gửi thử cho máy này** → khoá màn hình, 5 giây sau phải có thông báo.
   - **iPhone (iOS 16.4+):** phải mở bằng Safari → **Chia sẻ → Thêm vào Màn hình chính** → mở app từ icon BonBon rồi mới bật được.
6. Admin đăng menu / thêm món → mọi máy nhận thông báo. 15 phút trước giờ chốt, ai chưa đặt nhận thêm tin nhắc (cron của Worker). Tab **Tổng hợp** có nút **Nhắc bằng thông báo**.

Xem log Worker: `cd worker && npx wrangler tail`. Văn phòng hơn ~40 máy: mở `worker/wrangler.toml`, bỏ dấu `#` ở dòng `services = ...` rồi `npx wrangler deploy` lại.

### 7. Dùng lần đầu
Admin đăng nhập → **Quản lý** → nhập ngân hàng, số tài khoản, giờ chốt → **Lưu cài đặt** (bắt buộc lưu lại một lần để rules biết giờ chốt) → dán menu → **Đọc menu** → **Đăng menu**.

## Bảo mật

| Lớp | Cách bảo vệ |
|---|---|
| Đăng nhập | Chỉ tài khoản Google đã xác minh email; tên miền công ty kiểm tra trong rules (không chỉ ở giao diện) |
| Admin | Danh sách trong collection `admins`, chỉ sửa được trong Console |
| Đơn hàng | Mỗi người chỉ sửa đơn của mình; không tự đánh dấu "đã nhận tiền"; server chặn đặt/sửa/huỷ sau giờ chốt theo giờ server |
| Tổng tiền | Trang Tổng hợp tính lại theo giá trong menu, không tin số người dùng tự gửi |
| Email đồng nghiệp | Chỉ admin đọc được (collection `users`); không còn nằm trong đơn hàng |
| Token thông báo | Không ai đọc được từ app, chỉ Worker (service account) dùng |
| Worker gửi thông báo | Chỉ nhận yêu cầu có Firebase ID token hợp lệ (kiểm tra chữ ký Google); chỉ admin được gửi cho cả văn phòng; khoá service account nằm trong secret của Cloudflare |
| Script bên ngoài | Có SRI (bị sửa trên CDN thì không chạy) + Content-Security-Policy |

### Về `apiKey` trong `config.js`
`apiKey` của Firebase web **không phải mật khẩu**: mọi web app Firebase đều để lộ nó trong trình duyệt, và không thể giấu được trên trang tĩnh. Dữ liệu được bảo vệ bởi `firestore.rules`. Nên làm thêm:
1. **Giới hạn key:** Google Cloud Console → **APIs & Services → Credentials** → key "Browser key" → *Application restrictions*: **Websites** → thêm `https://<tên-github>.github.io/*`, `https://datcomtrua-14f62.firebaseapp.com/*`, `http://localhost/*`.
2. **App Check (khuyên dùng):** Firebase → **App Check** → đăng ký app web với **reCAPTCHA v3** → dán site key vào `APP_CHECK_SITE_KEY` → theo dõi vài ngày rồi bấm **Enforce** cho Firestore. Khi đó chỉ app của bạn gọi được Firestore, kể cả khi người khác lấy được apiKey.

## Cập nhật app
Sửa `app.js` / `index.html` xong thì tăng số phiên bản ở `index.html` (`app.js?v=…`) và trong `sw.js` (`VERSION`, danh sách `SHELL`). Service worker luôn lấy bản mới khi có mạng.

Tốc độ: app lưu menu / đơn hôm nay trên máy, lần mở sau hiện ngay (~2 ms) rồi cập nhật từ server.

## Dữ liệu
- `menus/{ngày}`: menu (không chứa ảnh) · `menuImages/{ngày}`: ảnh menu, chỉ tải khi bấm xem
- `days/{ngày}/orders/{uid}`: đơn của từng người trong ngày
- `config/settings`, `users/{uid}`, `admins/{email}`, `pushTokens/{token}`, `sent/{id}` (Worker dùng để không gửi trùng)

Collection `orders` của bản cũ không còn dùng, có thể xoá trong Console.
