/* Cloudflare Worker: gửi thông báo đẩy (FCM) cho app Cơm trưa BonBon.
 *
 * POST /notify  (admin)   Admin vừa đăng / thêm món → báo cho mọi máy đã bật thông báo
 * POST /remind  (admin)   Nhắc những người chưa đặt món hôm nay
 * POST /test    (ai cũng được) Gửi thử về chính các máy của người bấm (sau 5 giây)
 * Cron mỗi 5 phút          15 phút trước giờ chốt tự nhắc người chưa đặt
 *
 * Bảo mật: mọi yêu cầu phải kèm Firebase ID token (chữ ký Google được kiểm tra tại đây).
 * Khoá service account nằm trong secret FIREBASE_SA, không bao giờ gửi ra ngoài.
 */

const TZ = "Asia/Ho_Chi_Minh";
const CHUNK = 35; // số máy gửi mỗi lần chạy (chừa chỗ cho các lệnh gọi Firestore, giới hạn 50 của gói Free)
const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------------- tiện ích ---------------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = s => b64url(enc.encode(s));
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function vnNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour) * 60 + (+p.minute) };
}
const hm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
async function internalKey(env) { // khoá nội bộ cho lệnh tự gọi lại chính mình, suy ra từ secret
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode("bonbon-internal:" + env.FIREBASE_SA)));
}

/* ---------------- Google OAuth bằng service account ---------------- */
let tokenCache = null;
async function accessToken(env) {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const sa = JSON.parse(env.FIREBASE_SA);
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging"
  }));
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${claim}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` })
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google OAuth lỗi: " + (j.error_description || j.error || r.status));
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/* ---------------- kiểm tra Firebase ID token ---------------- */
let jwks = null, jwksExp = 0;
async function verifyIdToken(idToken, env) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("token sai định dạng");
  const [h, p, s] = parts;
  const header = JSON.parse(dec.decode(fromB64url(h)));
  const payload = JSON.parse(dec.decode(fromB64url(p)));
  if (header.alg !== "RS256") throw new Error("token sai thuật toán");
  if (!jwks || Date.now() > jwksExp) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    jwks = (await r.json()).keys || []; jwksExp = Date.now() + 3600_000;
  }
  const jwk = jwks.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("token không rõ khoá");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), enc.encode(`${h}.${p}`));
  const now = Date.now() / 1000;
  if (!ok) throw new Error("chữ ký token không hợp lệ");
  if (payload.aud !== env.PROJECT_ID || payload.iss !== `https://securetoken.google.com/${env.PROJECT_ID}`) throw new Error("token không thuộc project này");
  if (payload.exp < now || payload.iat > now + 300 || !payload.sub) throw new Error("token hết hạn");
  if (payload.firebase?.sign_in_provider !== "google.com" || payload.email_verified !== true) throw new Error("chỉ nhận tài khoản Google đã xác minh");
  const email = String(payload.email || "").toLowerCase();
  if (env.ALLOWED_DOMAIN && email.split("@")[1] !== env.ALLOWED_DOMAIN.toLowerCase()) throw new Error("email không thuộc công ty");
  return { uid: payload.sub, email };
}

/* ---------------- Firestore REST ---------------- */
const base = env => `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents`;
const auth = async env => ({ authorization: "Bearer " + await accessToken(env) });
function val(v) { // Firestore Value → JS
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  if ("mapValue" in v) return fields(v.mapValue.fields);
  return null;
}
const fields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, val(v)]));
async function fsGet(env, path) {
  const r = await fetch(`${base(env)}/${path}`, { headers: await auth(env) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Đọc ${path} lỗi ${r.status}`);
  return fields((await r.json()).fields);
}
async function fsList(env, path, mask) {
  const out = []; let pageToken = "";
  do {
    const u = new URL(`${base(env)}/${path}`);
    u.searchParams.set("pageSize", "300");
    if (mask) u.searchParams.append("mask.fieldPaths", mask);
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetch(u, { headers: await auth(env) });
    if (!r.ok) throw new Error(`Đọc danh sách ${path} lỗi ${r.status}`);
    const j = await r.json();
    out.push(...(j.documents || []));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}
async function fsSet(env, path, obj) { // chỉ hỗ trợ chuỗi, số nguyên, mảng chuỗi (đủ dùng cho sổ "đã gửi")
  const toV = v => Array.isArray(v) ? { arrayValue: { values: v.map(x => ({ stringValue: String(x) })) } }
    : typeof v === "number" ? { integerValue: String(Math.round(v)) } : { stringValue: String(v) };
  const r = await fetch(`${base(env)}/${path}`, {
    method: "PATCH", headers: { ...(await auth(env)), "content-type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toV(v)])) })
  });
  if (!r.ok) throw new Error(`Ghi ${path} lỗi ${r.status}`);
}
async function isAdmin(env, email) { return !!email && (await fsGet(env, `admins/${encodeURIComponent(email)}`)) !== null; }

/* ---------------- danh sách máy & gửi ---------------- */
async function allTokens(env, exceptUids) {
  const docs = await fsList(env, "pushTokens", "uid");
  return docs
    .map(d => ({ name: d.name, token: decodeURIComponent(d.name.split("/pushTokens/")[1]), uid: val(d.fields?.uid) }))
    .filter(t => !exceptUids || !exceptUids.has(t.uid));
}
async function tokensOf(env, uid) {
  const r = await fetch(`${base(env)}:runQuery`, {
    method: "POST", headers: { ...(await auth(env)), "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "pushTokens" }], where: { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: uid } } } } })
  });
  if (!r.ok) throw new Error(`Tìm máy lỗi ${r.status}`);
  return (await r.json()).filter(x => x.document).map(x => ({ name: x.document.name, token: decodeURIComponent(x.document.name.split("/pushTokens/")[1]), uid }));
}
// Gửi tới tối đa CHUNK máy trong lần chạy này
async function sendChunk(env, list, data) {
  const at = await accessToken(env);
  let ok = 0, dead = 0, fail = 0;
  await Promise.all(list.map(async t => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${env.PROJECT_ID}/messages:send`, {
      method: "POST", headers: { authorization: "Bearer " + at, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: t.token, data, webpush: { headers: { Urgency: "high", TTL: "10800" } } } })
    });
    if (r.ok) { ok++; return; }
    const txt = await r.text();
    if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(txt) || (r.status === 400 && /INVALID_ARGUMENT/.test(txt) && /token/i.test(txt))) {
      dead++; // máy đã gỡ app / tắt thông báo → xoá
      await fetch(`https://firestore.googleapis.com/v1/${t.name}`, { method: "DELETE", headers: { authorization: "Bearer " + at } }).catch(() => {});
    } else { fail++; console.warn("FCM", r.status, txt.slice(0, 200)); }
  }));
  return { ok, dead, fail };
}
// Chia nhiều máy thành nhiều đợt: đợt đầu gửi tại đây, các đợt sau nhờ chính Worker chạy (mỗi lần chạy có giới hạn riêng)
async function sendAll(env, list, data) {
  if (!env.SELF) { // chưa bật chia đợt: gửi lần lượt trong một lần chạy (đủ cho ~40 máy)
    const sum = { ok: 0, dead: 0, fail: 0 };
    for (let i = 0; i < list.length; i += CHUNK) {
      const r = await sendChunk(env, list.slice(i, i + CHUNK), data);
      sum.ok += r.ok; sum.dead += r.dead; sum.fail += r.fail;
    }
    return { ...sum, total: list.length };
  }
  const first = list.slice(0, CHUNK), rest = [];
  for (let i = CHUNK; i < list.length; i += CHUNK) rest.push(list.slice(i, i + CHUNK));
  const key = rest.length ? await internalKey(env) : "";
  const results = await Promise.all([
    sendChunk(env, first, data),
    ...rest.map(chunk => env.SELF.fetch("https://internal/chunk", { method: "POST", headers: { "x-internal": key, "content-type": "application/json" }, body: JSON.stringify({ list: chunk, data }) })
      .then(r => r.json()).catch(e => ({ ok: 0, dead: 0, fail: chunk.length, error: String(e) })))
  ]);
  const sum = results.reduce((a, r) => ({ ok: a.ok + (r.ok || 0), dead: a.dead + (r.dead || 0), fail: a.fail + (r.fail || 0) }), { ok: 0, dead: 0, fail: 0 });
  return { ...sum, total: list.length };
}

/* ---------------- nghiệp vụ ---------------- */
async function notifyMenu(env) {
  const day = vnNow().key;
  const menu = await fsGet(env, `menus/${day}`);
  if (!menu || !(menu.items || []).length) return { skipped: "Hôm nay chưa có menu" };
  const log = (await fsGet(env, `sent/menu-${day}`)) || {};
  const seen = new Set(log.ids || []);
  const added = menu.items.filter(i => i && i.name && !seen.has(i.id));
  if (!added.length) return { skipped: "Không có món mới so với lần báo trước" };
  await fsSet(env, `sent/menu-${day}`, { ids: menu.items.map(i => i.id), at: Date.now() }); // ghi trước để không gửi trùng
  const cfg = (await fsGet(env, "config/settings")) || {};
  const names = added.map(i => i.name);
  const isFirst = !seen.size;
  const data = {
    title: isFirst ? "Menu cơm trưa hôm nay đã có 🍚" : "Menu vừa có thêm món mới 🍽️",
    body: `${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}. Chọn món trước ${cfg.deadline || "10:30"} nhé!`,
    tag: `menu-${day}`
  };
  return sendAll(env, await allTokens(env), data);
}
async function remindTodo(env, auto) {
  const now = vnNow();
  const cfg = (await fsGet(env, "config/settings")) || {};
  const deadline = cfg.deadlineMin ?? 630;
  if (auto && (now.mins < deadline - 15 || now.mins >= deadline)) return { skipped: "Chưa tới giờ nhắc" };
  const menu = await fsGet(env, `menus/${now.key}`);
  if (!menu || !(menu.items || []).length) return { skipped: "Hôm nay chưa có menu" };
  if (menu.status === "closed") return { skipped: "Đã chốt đơn" };
  const logId = auto ? `sent/remind-${now.key}` : `sent/manual-${now.key}`;
  const log = await fsGet(env, logId);
  if (auto && log) return { skipped: "Hôm nay đã nhắc" };
  if (!auto && log && Date.now() - (log.at || 0) < 5 * 60_000) return { skipped: "Vừa nhắc xong, đợi 5 phút rồi thử lại" };
  await fsSet(env, logId, { at: Date.now() });
  const ordered = new Set((await fsList(env, `days/${now.key}/orders`, "at")).map(d => d.name.split("/").pop()));
  const left = deadline - now.mins;
  const data = {
    title: left > 0 && left <= 60 ? "Sắp chốt cơm trưa ⏰" : "Bạn chưa chọn cơm trưa 🍱",
    body: left > 0 ? `Còn ${left} phút nữa chốt (${hm(deadline)}). Vào chọn món nhé!` : "Vào chọn món nhé!",
    tag: `remind-${now.key}`
  };
  return sendAll(env, await allTokens(env, ordered), data);
}

/* ---------------- HTTP ---------------- */
function cors(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? {
    "access-control-allow-origin": origin, "vary": "origin",
    "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400"
  } : {};
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    // Đợt gửi phụ (chỉ chính Worker gọi được: cần khoá nội bộ suy ra từ secret)
    if (url.pathname === "/chunk" && req.method === "POST") {
      if (req.headers.get("x-internal") !== await internalKey(env)) return json({ error: "forbidden" }, 403);
      const { list, data } = await req.json();
      return json(await sendChunk(env, (list || []).slice(0, CHUNK), data));
    }

    if (req.method !== "POST" || !["/notify", "/remind", "/test"].includes(url.pathname)) return json({ error: "not found" }, 404, h);
    if (!env.FIREBASE_SA) return json({ error: "Worker chưa có secret FIREBASE_SA" }, 500, h);

    let user;
    try { user = await verifyIdToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""), env); }
    catch (e) { return json({ error: "Chưa đăng nhập hợp lệ: " + e.message }, 401, h); }

    try {
      if (url.pathname === "/test") {
        const list = await tokensOf(env, user.uid);
        if (!list.length) return json({ error: "Máy này chưa đăng ký nhận thông báo. Bấm chuông → Cho phép thông báo trước." }, 400, h);
        // Đợi 5 giây để kịp khoá màn hình, rồi mới gửi
        ctx.waitUntil(sleep(5000).then(() => sendChunk(env, list.slice(0, CHUNK), {
          title: "Thông báo thử 🔔", body: "Điện thoại của bạn đã nhận được thông báo từ Cơm trưa BonBon.", tag: "test"
        })));
        return json({ queued: list.length }, 200, h);
      }
      if (!(await isAdmin(env, user.email))) return json({ error: "Chỉ admin mới gửi được" }, 403, h);
      const result = url.pathname === "/notify" ? await notifyMenu(env) : await remindTodo(env, false);
      return json(result, 200, h);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500, h);
    }
  },

  async scheduled(event, env, ctx) {
    if (!env.FIREBASE_SA) return;
    ctx.waitUntil(remindTodo(env, true).then(r => console.log("cron nhắc:", JSON.stringify(r))).catch(e => console.error("cron lỗi:", e)));
  }
};
