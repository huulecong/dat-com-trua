# Đặt cơm trưa văn phòng · BonBon

Web app để cả văn phòng chọn cơm trưa mỗi ngày: admin đăng menu, mọi người chọn món, app tổng hợp số lượng gửi quán và hiện mã VietQR để chuyển khoản cho admin.

- Giao diện: HTML/JS tĩnh, chạy trên **GitHub Pages**, cài được như app trên điện thoại (PWA)
- Dữ liệu và đăng nhập: **Firebase** (Firestore + Google Sign-in)
- Thông báo đẩy: **Firebase Cloud Messaging + Cloud Functions** (khi admin đăng menu và 15 phút trước giờ chốt)

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

### 4. Deploy rules và Cloud Functions
Cloud Functions cần gói **Blaze** (trả theo mức dùng). Văn phòng vài chục người dùng nằm trong hạn mức miễn phí (2 triệu lượt gọi/tháng), nhưng vẫn phải gắn thẻ. Nên đặt **Budget alert** 1 USD trong Google Cloud Billing.

```bash
npm i -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

### 5. Đưa lên GitHub Pages
**Settings → Pages → Deploy from a branch → `main` / `(root)`**. Sau đó vào Firebase → **Authentication → Settings → Authorized domains** → thêm `<tên-github>.github.io`.

### 6. Bật thông báo đẩy
1. Không cần cấu hình thêm: app dùng khoá Web Push mặc định của Firebase. (Muốn dùng khoá riêng thì tạo ở **Project settings → Cloud Messaging → Web Push certificates** và dán vào `VAPID_KEY`.)
2. Mọi người mở app → bấm **Cho phép thông báo** trên banner, hoặc bấm **nút chuông** ở góc trên (chấm cam = chưa bật).
   - **iPhone (iOS 16.4 trở lên):** mở bằng Safari → nút **Chia sẻ** → **Thêm vào Màn hình chính** → mở app từ icon BonBon → bấm **Bật thông báo**. iPhone chỉ cho web gửi thông báo khi đã cài như vậy.
   - **Android / máy tính:** bấm **Bật thông báo** ngay trên trình duyệt (Chrome cũng có mục "Cài đặt ứng dụng").
3. Admin đăng menu → mọi máy đã bật nhận thông báo trong vài giây. 15 phút trước giờ chốt, ai chưa đặt sẽ nhận thêm thông báo nhắc.

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
| Token thông báo | Không ai đọc được từ app, chỉ Cloud Functions dùng |
| Script bên ngoài | Có SRI (bị sửa trên CDN thì không chạy) + Content-Security-Policy |

### Về `apiKey` trong `config.js`
`apiKey` của Firebase web **không phải mật khẩu**: mọi web app Firebase đều để lộ nó trong trình duyệt, và không thể giấu được trên trang tĩnh. Dữ liệu được bảo vệ bởi `firestore.rules`. Nên làm thêm:
1. **Giới hạn key:** Google Cloud Console → **APIs & Services → Credentials** → key "Browser key" → *Application restrictions*: **Websites** → thêm `https://<tên-github>.github.io/*`, `https://datcomtrua-14f62.firebaseapp.com/*`, `http://localhost/*`.
2. **App Check (khuyên dùng):** Firebase → **App Check** → đăng ký app web với **reCAPTCHA v3** → dán site key vào `APP_CHECK_SITE_KEY` → theo dõi vài ngày rồi bấm **Enforce** cho Firestore. Khi đó chỉ app của bạn gọi được Firestore, kể cả khi người khác lấy được apiKey.

## Cập nhật app
Sửa `app.js` / `index.html` xong thì tăng số phiên bản ở `index.html` (`app.js?v=…`), trong `sw.js` (`VERSION` và danh sách `SHELL`) để điện thoại tải bản mới.

## Dữ liệu
- `menus/{ngày}`: menu (không chứa ảnh) · `menuImages/{ngày}`: ảnh menu, chỉ tải khi bấm xem
- `days/{ngày}/orders/{uid}`: đơn của từng người trong ngày
- `config/settings`, `users/{uid}`, `admins/{email}`, `pushTokens/{token}`, `sent/{id}` (Cloud Functions dùng để không gửi trùng)

Collection `orders` của bản cũ không còn dùng, có thể xoá trong Console.
