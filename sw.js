/* Service worker: nhận thông báo đẩy (FCM) khi app đóng + cache để mở app nhanh, dùng được khi mạng yếu.
   Đổi VERSION mỗi lần sửa app.js / index.html để máy người dùng lấy bản mới. */
const VERSION = "v8";
const SHELL = ["./", "./index.html", "./app.js?v=8", "./config.js?v=6", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Trang HTML: lấy mạng trước (luôn có bản mới), mất mạng thì dùng cache.
// File tĩnh của app + Firebase SDK (có version trong URL): dùng cache trước, cập nhật nền.
// Dữ liệu Firestore / đăng nhập: không đụng tới.
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === self.location.origin;
  const sdk = url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameOrigin && !sdk) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put("./", c)); return r; })
      .catch(() => caches.match("./")));
    return;
  }
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

// Thông báo đẩy từ FCM (n8n gửi khi admin đăng menu)
self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) { p = { notification: { body: e.data && e.data.text() } }; }
  const n = p.notification || {}, d = p.data || {};
  const title = n.title || d.title || "Cơm trưa";
  const link = (p.fcmOptions && p.fcmOptions.link) || d.link || n.click_action || "./";
  e.waitUntil(self.registration.showNotification(title, {
    body: n.body || d.body || "Menu hôm nay đã có, vào chọn món nhé.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || "menu",
    renotify: true,
    data: { link }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.link) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const w of list) if (w.url.startsWith(self.registration.scope)) { w.focus(); return w.navigate ? w.navigate(target).catch(() => {}) : null; }
    return self.clients.openWindow(target);
  }));
});
