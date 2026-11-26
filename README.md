# Đặt cơm trưa văn phòng

Web app để cả văn phòng chọn cơm trưa mỗi ngày: admin đăng menu, mọi người chọn món, app tổng hợp số lượng gửi quán và hiện mã VietQR để chuyển khoản cho admin.

- Giao diện: HTML/JS tĩnh, chạy trên **GitHub Pages**
- Dữ liệu và đăng nhập: **Firebase** (Firestore + Google Sign-in, gói miễn phí Spark)
- Nhắc nhở hằng ngày: **n8n** (file `n8n-nhac-dat-com.json`)

## Cài đặt (khoảng 15 phút)

### 1. Tạo Firebase
1. Vào https://console.firebase.google.com → **Add project** (tắt Google Analytics cũng được).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save**.
3. **Build → Firestore Database → Create database** → chọn vùng `asia-southeast1` (Singapore) → **Start in production mode**.
4. Tab **Rules** của Firestore: xoá hết, dán nội dung file `firestore.rules`, sửa email admin, bấm **Publish**.
5. **Project settings (bánh răng) → General → Your apps → biểu tượng `</>`** → đặt tên app → **Register**. Copy đoạn `firebaseConfig`.

### 2. Sửa `config.js`
- Dán `firebaseConfig` vừa copy.
- Điền email admin vào `ADMIN_EMAILS` (giống trong rules).
- (Tuỳ chọn) `ALLOWED_DOMAIN = "congty.vn"` để chỉ email công ty đăng nhập được.

> `apiKey` của Firebase web được phép công khai, việc bảo vệ dữ liệu do `firestore.rules` đảm nhiệm.

### 3. Đưa lên GitHub Pages
1. Tạo repo mới tên `dat-com-trua` (Public).
2. **Add file → Upload files** → kéo tất cả file trong thư mục này vào → **Commit**.
3. **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. Sau 1–2 phút, app chạy tại `https://<tên-github>.github.io/dat-com-trua/`.

### 4. Cho phép tên miền đăng nhập
Firebase → **Authentication → Settings → Authorized domains → Add domain** → thêm `<tên-github>.github.io`.

### 5. Dùng lần đầu
1. Admin mở link, đăng nhập Google, vào **Menu & cài đặt** → nhập ngân hàng, số tài khoản, giờ chốt → **Lưu cài đặt**.
2. Dán menu (mỗi dòng một món có giá, ví dụ `Cơm gà 35k`) → **Đọc menu** → kiểm tra → **Đăng menu**.
3. Gửi link cho mọi người.

### 6. Nhắc nhở tự động bằng n8n
Import `n8n-nhac-dat-com.json` vào n8n, gắn credential Telegram bot, thay `THAY_BANG_CHAT_ID_NHOM` và `THAY_BANG_LINK_APP`, bật workflow. Mặc định nhắc 9:00 và 10:15 từ thứ 2 đến thứ 6 (giờ Việt Nam).
