/* Gửi thông báo đẩy trực tiếp từ Firebase (không cần n8n hay server riêng).
   - notifyNewMenu: admin đăng menu hôm nay → báo tới mọi điện thoại đã bật thông báo.
   - remindBeforeDeadline: 15 phút trước giờ chốt → nhắc những người chưa đặt. */
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
// Cùng vùng với Firestore (asia-southeast1). Giới hạn số instance để không phát sinh chi phí bất ngờ.
setGlobalOptions({ region: "asia-southeast1", maxInstances: 2, memory: "256MiB" });

const TZ = "Asia/Ho_Chi_Minh";
function vnNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour) * 60 + (+p.minute) };
}
const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Đánh dấu "đã gửi" bằng create(): trigger có thể chạy lặp, create() lần 2 sẽ lỗi → không gửi trùng
async function once(id) {
  try { await db.doc(`sent/${id}`).create({ at: Date.now() }); return true; }
  catch (e) { if (e.code === 6 /* ALREADY_EXISTS */) return false; throw e; }
}

async function sendTo(tokens, data) {
  let ok = 0;
  const dead = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      data, // chỉ gửi data, service worker (sw.js) tự hiện thông báo
      webpush: { headers: { Urgency: "high", TTL: "10800" } }
    });
    res.responses.forEach((r, j) => {
      if (r.success) ok++;
      else if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"].includes(r.error?.code)) dead.push(batch[j]);
      else logger.warn("FCM lỗi", r.error?.code);
    });
  }
  // Xoá token của máy đã gỡ app / tắt thông báo
  await Promise.all(dead.map(t => db.doc(`pushTokens/${t}`).delete().catch(() => {})));
  logger.info(`Đã gửi ${ok}/${tokens.length}, xoá ${dead.length} token hỏng`);
}

async function tokens(exceptUids = new Set()) {
  const snap = await db.collection("pushTokens").get();
  return snap.docs.filter(d => !exceptUids.has(d.get("uid"))).map(d => d.id);
}

exports.notifyNewMenu = onDocumentCreated("menus/{day}", async event => {
  const day = event.params.day;
  if (day !== vnNow().key) return;            // chỉ báo cho menu của hôm nay
  if (!(await once(`menu-${day}`))) return;
  const names = (event.data?.get("items") || []).map(i => i.name).filter(Boolean);
  const cfg = (await db.doc("config/settings").get()).data() || {};
  const body = (names.length ? names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "") + ". " : "")
    + `Chọn món trước ${cfg.deadline || "10:30"} nhé!`;
  await sendTo(await tokens(), { title: "Menu cơm trưa hôm nay đã có 🍚", body, tag: `menu-${day}` });
});

exports.remindBeforeDeadline = onSchedule({ schedule: "*/5 7-13 * * 1-5", timeZone: TZ }, async () => {
  const now = vnNow();
  const cfg = (await db.doc("config/settings").get()).data() || {};
  const deadline = cfg.deadlineMin ?? 630;
  if (now.mins < deadline - 15 || now.mins >= deadline) return;
  const menu = await db.doc(`menus/${now.key}`).get();
  if (!menu.exists || menu.get("status") === "closed") return;
  if (!(await once(`remind-${now.key}`))) return;
  const ordered = new Set((await db.collection(`days/${now.key}/orders`).get()).docs.map(d => d.id));
  await sendTo(await tokens(ordered), {
    title: "Sắp chốt cơm trưa ⏰",
    body: `Còn ${deadline - now.mins} phút nữa chốt (${hm(deadline)}). Bạn chưa chọn món!`,
    tag: `remind-${now.key}`
  });
});
