/* Chạy trước app.js (viết kiểu cũ để máy đời cũ cũng chạy được).
   Nếu app không khởi động được thì hiện lỗi + nút sửa, thay vì để màn hình trống. */
(function () {
  var shown = false;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fix() {
    var done = function () { location.reload(); };
    var p = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]);
    p.then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
      .then(function () { return window.caches ? caches.keys() : []; })
      .then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
      .then(done, done);
  }
  function show(msg) {
    if (shown || window.__appStarted) return;
    shown = true;
    var v = document.getElementById("view");
    if (!v) return;
    v.innerHTML = '<div class="empty"><div class="art">🛠️</div><h3>App chưa khởi động được</h3>'
      + '<p>' + esc(msg) + '</p>'
      + '<div class="row" style="justify-content:center"><button class="btn" id="bootFix">Xoá bộ nhớ đệm &amp; tải lại</button>'
      + '<button class="btn ghost" id="bootReload">Tải lại</button></div>'
      + '<p class="hint" style="margin-top:16px;font-size:12px">Vẫn lỗi thì chụp màn hình này gửi admin.<br>' + esc(navigator.userAgent) + '</p></div>';
    document.getElementById("bootFix").onclick = fix;
    document.getElementById("bootReload").onclick = function () { location.reload(); };
  }
  // Lỗi JS (kể cả lỗi cú pháp trong app.js) và lỗi tải file script
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "SCRIPT") return show("Không tải được " + (t.src || "script").split("/").pop() + ". Kiểm tra mạng rồi thử lại.");
    if (e.message) show(e.message + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : ""));
  }, true);
  setTimeout(function () { show("Quá 12 giây vẫn chưa tải xong. Có thể do mạng yếu hoặc máy còn lưu bản cũ."); }, 12000);
})();
