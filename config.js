// 1) Cấu hình Firebase web (Firebase Console → Project settings → Your apps → Web app → Config)
//    apiKey của Firebase web là định danh công khai, KHÔNG phải mật khẩu: trình duyệt nào chạy app cũng thấy.
//    Dữ liệu được bảo vệ bởi firestore.rules. Xem mục "Bảo mật" trong README để giới hạn key theo tên miền.
export const firebaseConfig = {
  apiKey: "AIzaSyDaCWFsxIrDnhkqHSahb1qyTs6RkCvKOmY",
  authDomain: "datcomtrua-14f62.firebaseapp.com",
  projectId: "datcomtrua-14f62",
  storageBucket: "datcomtrua-14f62.firebasestorage.app",
  messagingSenderId: "61198673908",
  appId: "1:61198673908:web:25509a74537b5ed3f83ba1",
  measurementId: "G-52YXWL04VB"
};

// 2) Admin KHÔNG khai báo ở đây nữa (để không lộ email trong repo public).
//    Tạo trong Firebase Console: Firestore → collection "admins" → Document ID = email admin (chữ thường).

// 3) (Không bắt buộc) Chỉ cho email thuộc công ty đăng nhập, ví dụ "congty.vn".
//    Phải trùng allowedDomain() trong firestore.rules (rules mới là nơi thực sự chặn).
export const ALLOWED_DOMAIN = "";

// 4) (Không bắt buộc, khuyên dùng) Firebase App Check với reCAPTCHA v3: chỉ app của bạn mới gọi được Firestore.
//    Dán site key reCAPTCHA v3 vào đây sau khi bật App Check (xem README). Để "" nếu chưa dùng.
export const APP_CHECK_SITE_KEY = "";

// 5) (Không bắt buộc) Khoá Web Push riêng cho thông báo đẩy.
//    Để "" thì Firebase dùng khoá mặc định, thông báo vẫn chạy bình thường.
//    Muốn dùng khoá riêng: Firebase Console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
export const VAPID_KEY = "";

// 6) Địa chỉ Cloudflare Worker gửi thông báo đẩy (xem README mục "Thông báo đẩy").
//    Ví dụ "https://bonbon-push.ten-ban.workers.dev". Để "" thì app vẫn chạy, chỉ không gửi được thông báo khi app đóng.
export const PUSH_WORKER_URL = "";
