// 1) Dán cấu hình Firebase của bạn vào đây
//    (Firebase Console → Project settings → Your apps → Web app → SDK setup and configuration → Config)
const firebaseConfig = {
  apiKey: "AIzaSyDaCWFsxIrDnhkqHSahb1qyTs6RkCvKOmY",
  authDomain: "datcomtrua-14f62.firebaseapp.com",
  projectId: "datcomtrua-14f62",
  storageBucket: "datcomtrua-14f62.firebasestorage.app",
  messagingSenderId: "61198673908",
  appId: "1:61198673908:web:25509a74537b5ed3f83ba1",
  measurementId: "G-52YXWL04VB"
};

// 2) Email Google của admin (người đăng menu, xem tổng hợp, xác nhận tiền).
//    Phải trùng với danh sách trong firestore.rules.
export const ADMIN_EMAILS = [
  "anhuynh14business@gmail.com"
];

// 3) (Không bắt buộc) Chỉ cho email thuộc công ty đăng nhập, ví dụ "congty.vn".
//    Để trống "" nếu mọi tài khoản Google đều được dùng.
export const ALLOWED_DOMAIN = "";
