import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ALLOWED_DOMAIN, APP_CHECK_SITE_KEY, VAPID_KEY } from "./config.js?v=6";

const TZ = "Asia/Ho_Chi_Minh";
const BANKS = [
  ["Vietcombank","970436"],["VietinBank","970415"],["BIDV","970418"],["Agribank","970405"],
  ["Techcombank","970407"],["MB Bank","970422"],["ACB","970416"],["VPBank","970432"],
  ["TPBank","970423"],["Sacombank","970403"],["VIB","970441"],["HDBank","970437"],
  ["SHB","970443"],["MSB","970426"],["OCB","970448"],["SeABank","970440"],
  ["LPBank","970449"],["Eximbank","970431"],["Nam A Bank","970428"],["BVBank / Timo","970454"],["Cake by VPBank","546034"]
];
const WEEKDAYS = ["Chủ nhật","Thứ hai","Thứ ba","Thứ tư","Thứ năm","Thứ sáu","Thứ bảy"];

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => (Math.round(n)||0).toLocaleString("vi-VN") + "đ";
const ascii = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").replace(/[^A-Za-z0-9 ]/g," ").replace(/\s+/g," ").trim().toUpperCase();
function vnNow(){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return { key:`${p.year}-${p.month}-${p.day}`, mins:(+p.hour)*60+(+p.minute), y:+p.year, m:+p.month, d:+p.day };
}
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),2800); }
async function copy(text){
  try{ await navigator.clipboard.writeText(text); toast("Đã sao chép"); return; }catch(e){}
  const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select();
  try{ document.execCommand("copy"); toast("Đã sao chép"); }catch(e){ toast("Không sao chép được, hãy sao chép thủ công"); }
  ta.remove();
}
const parseHM = s => { const m=/^(\d{1,2}):(\d{2})$/.exec(s||""); return m ? (+m[1])*60+(+m[2]) : 630; };
const uidShort = () => Math.random().toString(36).slice(2,8);

/* VietQR (chuẩn NAPAS / EMVCo) */
const tlv = (id,v) => id+String(v.length).padStart(2,"0")+v;
function crc16(s){ let c=0xFFFF; for(let i=0;i<s.length;i++){ c^=s.charCodeAt(i)<<8; for(let j=0;j<8;j++) c=(c&0x8000)?((c<<1)^0x1021)&0xFFFF:(c<<1)&0xFFFF; } return c.toString(16).toUpperCase().padStart(4,"0"); }
function vietqr(bin,acc,amount,info){
  const m=tlv("00","A000000727")+tlv("01",tlv("00",bin)+tlv("01",acc))+tlv("02","QRIBFTTA");
  const p=tlv("00","01")+tlv("01",amount?"12":"11")+tlv("38",m)+tlv("53","704")+(amount?tlv("54",String(Math.round(amount))):"")+tlv("58","VN")+(info?tlv("62",tlv("08",info.slice(0,25))):"")+"6304";
  return p+crc16(p);
}
function qrSvg(text){
  if(typeof window.qrcode!=="function") return null;
  try{ const q=window.qrcode(0,"M"); q.addData(text); q.make(); return q.createSvgTag({cellSize:4,margin:0,scalable:true}); }catch(e){ return null; }
}

/* Đọc menu dạng chữ: "Cơm gà 35k", "Cơm sườn 40.000" */
function parseMenuText(text){
  const out=[];
  for(let line of String(text||"").split(/\n+/)){
    line=line.replace(/^[\s\-•*\d.)]+(?=\D)/,"").trim(); if(!line) continue;
    const m=/^(.*?)[\s:\-–—.…]*?(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|K|nghìn|ngàn|đ|d|vnđ|vnd|VND|VNĐ)?\s*$/.exec(line);
    if(!m||!m[1].trim()) continue;
    let n=+m[2].replace(/[.,]/g,""); if(/^k$/i.test(m[3]||"")||/ngh|ngà/.test(m[3]||"")||n<1000) n*=1000;
    out.push({id:uidShort(),name:m[1].trim().replace(/[:\-–—.]+$/,"").trim(),price:n});
  }
  return out;
}

/* Nén ảnh menu thành JPEG nhỏ để lưu trong Firestore (giới hạn 1 MB/tài liệu) */
function compressImage(file, maxSide=1280, quality=0.7){
  return new Promise((res,rej)=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      const k=Math.min(1,maxSide/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg",quality));
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("Ảnh không đọc được")); };
    img.src=url;
  });
}

/* ---------- Firebase ---------- */
const configured = !/DAN_API_KEY/.test(firebaseConfig.apiKey);
let app, auth, fs;
if(configured){
  app=initializeApp(firebaseConfig);
  if(APP_CHECK_SITE_KEY){
    try{
      const ac=await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js");
      ac.initializeAppCheck(app,{provider:new ac.ReCaptchaV3Provider(APP_CHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});
    }catch(e){ console.warn("App Check:",e); }
  }
  auth=getAuth(app);
  // Lưu dữ liệu vào máy: lần mở sau hiện menu ngay, không chờ mạng
  try{ fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})}); }
  catch(e){ fs=getFirestore(app); }
}
const skeleton = () => `<div class="sk" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><span class="sr">Đang tải</span>`;

/* ---------- state ---------- */
const S = {
  today: vnNow(), tab:"order", authUser:null, authReady:false,
  uid:null, myName:"", isAdmin:false,
  settings:null, menu:null, orders:{}, users:{}, loaded:{menu:false,orders:false},
  images:null, imagesDay:null, imagesLoading:false,
  cart:{}, note:"", cartDirty:false,
  draft:null, draftDirty:false, imgDraft:null, setDraft:null, setDirty:false, busy:false
};
const dayKey = () => S.today.key;
// Đơn hôm nay: days/{ngày}/orders/{uid} — chỉ tải đơn của ngày hôm nay, không tải lịch sử
const orderRef = uid => doc(fs,"days",dayKey(),"orders",uid);
const myDay = () => S.orders[S.uid] || null;
const deadlineMins = () => parseHM(S.settings?.deadline || "10:30");
function isLocked(){
  const st=S.menu?.status||"auto";
  if(st==="open") return false;
  if(st==="closed") return true;
  return vnNow().mins >= deadlineMins();
}
function todayOrders(){
  // Tên món và giá lấy theo menu (không tin số liệu người dùng tự ghi), tổng tiền tính lại
  const byId=Object.fromEntries((S.menu?.items||[]).map(i=>[i.id,i])), list=[];
  for(const [uid,x] of Object.entries(S.orders)){
    if(!Array.isArray(x?.items) || !x.items.length) continue;
    const items=x.items.map(i=>{ const m=byId[i.id]; const qty=Math.max(0,Math.round(+i.qty||0)); return m?{id:i.id,name:m.name,price:m.price,qty}:{id:i.id,name:String(i.name||""),price:+i.price||0,qty}; }).filter(i=>i.qty>0);
    if(!items.length) continue;
    list.push({...x,uid,items,total:items.reduce((a,i)=>a+i.qty*i.price,0)});
  }
  return list;
}

/* ---------- header ---------- */
function renderHeader(){
  const t=S.today, wd=new Date(Date.UTC(t.y,t.m-1,t.d)).getUTCDay();
  $("#date").textContent=`${WEEKDAYS[wd]}, ${String(t.d).padStart(2,"0")}/${String(t.m).padStart(2,"0")}`;
  const clock=$("#clock"), txt=$("#clockText"), dl=S.settings?.deadline||"10:30";
  const set=(cls,text)=>{ clock.className="status"+(cls?" "+cls:""); txt.textContent=text; };
  clock.hidden=!S.authUser || !S.loaded.menu;
  if(clock.hidden) return;
  if(!S.menu) return set("","Chưa có menu");
  if(isLocked()) return set("",`Đã chốt lúc ${dl}`);
  const left=deadlineMins()-vnNow().mins;
  if((S.menu.status||"auto")==="open" && left<=0) return set("open","Đang mở thêm giờ");
  const h=Math.floor(left/60), m=left%60;
  set(left<=15?"open urgent":"open",`Còn ${h?h+"g ":""}${m} phút · chốt ${dl}`);
}
setInterval(()=>{
  const n=vnNow();
  if(n.key!==S.today.key){ S.today=n; S.cart={}; S.note=""; S.cartDirty=false; S.draftDirty=false; S.imgDraft=null; if(S.authUser) subscribeDay(); }
  const was=S._locked; S._locked=isLocked(); renderHeader();
  if(was!==S._locked && S.tab==="order") safeRender();
},30000);

/* ---------- render plumbing ---------- */
let pending=false;
const editing = () => { const a=document.activeElement; return a && $("#view").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName); };
function safeRender(){ if(editing()){ pending=true; return; } render(); }
$("#view").addEventListener("focusout",()=>{ if(pending) setTimeout(()=>{ if(!editing()){ pending=false; render(); } },0); });

function render(){
  renderHeader();
  const v=$("#view");
  $("#who").hidden=!S.authUser; $("#tabs").hidden=!S.authUser;
  if(!configured){ v.innerHTML=`<div class="empty"><h3>Chưa cấu hình Firebase</h3><p>Mở file config.js, dán cấu hình Firebase và email admin rồi tải lại trang. Hướng dẫn nằm trong README.md.</p></div>`; $("#bar").hidden=true; return; }
  if(!S.authReady){ v.innerHTML=skeleton(); return; }
  if(!S.authUser){ v.innerHTML=signInView(); $("#bar").hidden=true; return; }
  $("#whoName").textContent=S.myName;
  document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected", String(b.dataset.tab===S.tab)));
  $("#adminTab").hidden=!S.isAdmin;
  if(S.tab==="order") v.innerHTML=orderView();
  else if(S.tab==="summary") v.innerHTML=summaryView();
  else v.innerHTML=adminView();
  updateBar();
}
$("#tabs").addEventListener("click",e=>{
  const b=e.target.closest(".tab"); if(!b) return;
  S.tab=b.dataset.tab; pending=false; render(); window.scrollTo({top:0});
});

function signInView(){
  return `<div class="empty"><h3>Đăng nhập để chọn món</h3><p>Dùng tài khoản Google${ALLOWED_DOMAIN?` @${esc(ALLOWED_DOMAIN)}`:""}. Đặt xong sẽ có mã QR để chuyển khoản.</p><button class="btn" data-act="signIn">Đăng nhập bằng Google</button></div>`;
}

/* ---------- order tab ---------- */
function orderView(){
  if(!S.loaded.menu||!S.loaded.orders) return skeleton();
  if(!S.menu || !(S.menu.items||[]).length){
    return `<div class="empty"><h3>Hôm nay chưa có menu</h3><p>${S.isAdmin?"Đăng menu để mọi người bắt đầu chọn món.":"Menu chưa được đăng. Có menu là trang này tự cập nhật, không cần tải lại."}</p>${S.isAdmin?`<button class="btn" data-act="goAdmin">Đăng menu hôm nay</button>`:""}</div>${notifyPanel()}`;
  }
  const locked=isLocked() && !S.isAdmin, saved=myDay();
  if(!S.cartDirty){ S.cart={}; (saved?.items||[]).forEach(i=>S.cart[i.id]=i.qty); S.note=saved?.note||""; }
  let h=notifyPanel();
  if(saved && saved.items?.length) h+=ticketView(saved);
  const imgCount=S.menu.imageCount ?? (S.menu.images||[]).length;
  h+=`<h2>${saved?"Đổi món":"Menu"}</h2>`;
  if(S.menu.note) h+=`<p class="note">${esc(S.menu.note)}</p>`;
  if(locked) h+=`<p class="note">Đã chốt đơn. Muốn đổi món thì nhắn admin.</p>`;
  h+=`<ul class="menu">`;
  for(const it of S.menu.items){
    const q=S.cart[it.id]||0;
    h+=`<li class="item${q?" on":""}" data-id="${esc(it.id)}">
      <button class="item-main" data-act="pick" ${locked?"disabled":""}><span class="item-name">${esc(it.name)}</span><span class="lead"></span><span class="price num">${money(it.price)}</span></button>
      <div class="ctrl" role="group" aria-label="Số lượng ${esc(it.name)}">
        <button data-act="dec" aria-label="Bớt một" ${locked?"disabled":""}>−</button>
        <output class="num">${q}</output>
        <button data-act="inc" aria-label="Thêm một" ${locked?"disabled":""}>+</button>
      </div>
    </li>`;
  }
  h+=`</ul>`;
  if(imgCount){
    const imgs=currentImages();
    h+=`<details class="photos" data-photos${S.photosOpen?" open":""}><summary>Xem ảnh menu gốc (${imgCount})</summary>${imgs?imgsHtml(imgs,"Ảnh menu"):`<p class="hint">Đang tải ảnh…</p>`}</details>`;
  }
  h+=`<label class="field" for="note">Ghi chú cho quán</label><textarea id="note" rows="2" placeholder="Ít cơm, không hành…" ${locked?"disabled":""}>${esc(S.note)}</textarea>`;
  return h;
}
/* Ảnh menu: tách khỏi doc menu, chỉ tải khi cần (mở "Xem ảnh" hoặc vào tab Quản lý) */
const safeImg = u => typeof u==="string" && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u);
const imgsHtml = (list,alt) => list.filter(safeImg).map((u,i)=>`<img src="${esc(u)}" alt="${esc(alt)} ${i+1}" loading="lazy" decoding="async">`).join("");
function currentImages(){
  if(Array.isArray(S.menu?.images)) return S.menu.images; // menu cũ còn lưu ảnh trong doc
  return S.imagesDay===dayKey() ? S.images : null;
}
async function loadImages(){
  const day=dayKey();
  if(!S.menu || currentImages() || S.imagesLoading) return;
  S.imagesLoading=true;
  try{
    const s=await getDoc(doc(fs,"menuImages",day));
    if(day===dayKey()){ S.images=s.exists()?(s.data().images||[]):[]; S.imagesDay=day; safeRender(); }
  }catch(e){ console.warn("menuImages:",e.code||e); }
  S.imagesLoading=false;
}
function ticketView(d){
  const st=S.settings||{}, bank=BANKS.find(b=>b[1]===st.bankBin);
  const info=ascii(`COM ${dayKey().slice(8,10)}${dayKey().slice(5,7)} ${S.myName}`).slice(0,25);
  let pay="";
  if(!d.paid){
    if(st.bankBin && st.accountNo){
      const svg=qrSvg(vietqr(st.bankBin,st.accountNo,d.total,info));
      pay=`<div class="pay">
        <div class="qr-box">${svg||`<p>Chưa hiện được mã QR, chuyển khoản theo thông tin bên cạnh.</p>`}</div>
        <dl>
          <div><dt>Ngân hàng</dt><dd>${esc(bank?bank[0]:st.bankBin)}</dd></div>
          <div><dt>Số tài khoản</dt><dd class="num">${esc(st.accountNo)}<button class="copy" data-act="copyAcc">Chép</button></dd></div>
          ${st.accountName?`<div><dt>Chủ tài khoản</dt><dd>${esc(st.accountName)}</dd></div>`:""}
          <div><dt>Nội dung</dt><dd>${esc(info)}<button class="copy" data-act="copyInfo" data-v="${esc(info)}">Chép</button></dd></div>
        </dl>
      </div>`;
    } else pay=`<p class="t-note">Admin chưa nhập tài khoản nhận tiền nên chưa có mã QR.</p>`;
  }
  const status = d.paid ? `<span class="chip">Đã thanh toán</span>` : d.paidClaim ? `<span class="chip wait">Chờ admin xác nhận</span>` : `<span class="chip no">Chưa thanh toán</span>`;
  const n=d.items.reduce((a,i)=>a+i.qty,0);
  const claim = (!d.paid && !d.paidClaim) ? `<button class="btn small" data-act="claimPaid">Tôi đã chuyển khoản</button>` : `<span></span>`;
  return `<section class="ticket" aria-label="Đơn của bạn">
    <div class="t-head"><div><p class="t-title">Đơn của bạn · ${n} phần</p><p class="t-total num">${money(d.total)}</p></div>${status}</div>
    <ul class="lines">${d.items.map(i=>`<li><span>${i.qty} × ${esc(i.name)}</span><span class="num">${money(i.price*i.qty)}</span></li>`).join("")}</ul>
    ${d.note?`<p class="t-note">Ghi chú: ${esc(d.note)}</p>`:""}
    ${pay}
    <div class="t-foot">${claim}${(!isLocked()||S.isAdmin)?`<button class="link" data-act="cancel">Huỷ đơn</button>`:""}</div>
  </section>`;
}
function cartTotals(){ let n=0,t=0; for(const it of (S.menu?.items||[])){ const q=S.cart[it.id]||0; n+=q; t+=q*it.price; } return {n,t}; }
function updateBar(){
  const bar=$("#bar");
  if(!S.authUser||S.tab!=="order"||!S.menu||!(S.menu.items||[]).length){ bar.hidden=true; return; }
  const {n,t}=cartTotals(), saved=myDay(), locked=isLocked()&&!S.isAdmin;
  bar.hidden=false;
  $("#barTotal").textContent=money(t);
  $("#barSub").textContent=n?`${n} phần`:"Chưa chọn món";
  const btn=$("#barBtn");
  btn.textContent = saved ? (S.cartDirty?"Lưu thay đổi":"Đã đặt") : (n?`Đặt ${n} phần`:"Đặt món");
  btn.disabled = locked || !n || (saved && !S.cartDirty) || S.busy;
}
function updateItemRow(id){
  const li=document.querySelector(`.item[data-id="${CSS.escape(id)}"]`); if(!li) return;
  const q=S.cart[id]||0; li.classList.toggle("on",q>0); li.querySelector("output").textContent=q;
}

/* ---------- summary tab ---------- */
function aggregate(){
  const list=todayOrders(), byDish={}; let portions=0,total=0,paid=0;
  for(const o of list){
    for(const i of o.items){ byDish[i.name]=byDish[i.name]||{name:i.name,price:i.price,qty:0}; byDish[i.name].qty+=i.qty; portions+=i.qty; }
    total+=o.total; if(o.paid) paid+=o.total;
  }
  return {list,dishes:Object.values(byDish).sort((a,b)=>b.qty-a.qty),portions,total,paid};
}
function summaryView(){
  if(!S.loaded.orders) return skeleton();
  const a=aggregate();
  if(!a.list.length) return `<div class="empty"><h3>Chưa ai đặt món</h3><p>Có người đặt là danh sách hiện ở đây.</p></div>${remindPanel()}`;
  let h=remindPanel()+`<div class="stats"><div class="stat"><b class="num">${a.portions}</b><span>phần</span></div><div class="stat"><b class="num">${a.list.length}</b><span>người</span></div><div class="stat"><b class="num">${money(a.total)}</b><span>tổng</span></div></div>`;
  h+=`<div class="row"><button class="btn" data-act="copyStore">Chép tin gửi quán</button><button class="btn ghost" data-act="csv">Tải file Excel</button></div>`;
  h+=`<h2>Theo món</h2><div class="tbl-wrap"><table><thead><tr><th>Món</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr></thead><tbody>`;
  for(const d of a.dishes) h+=`<tr><td>${esc(d.name)}</td><td class="r num"><b>${d.qty}</b></td><td class="r num">${money(d.price)}</td><td class="r num">${money(d.price*d.qty)}</td></tr>`;
  h+=`</tbody></table></div><h2>Theo người</h2><p class="hint">Đã thu ${money(a.paid)} / ${money(a.total)}</p><ul class="people">`;
  for(const o of a.list.sort((x,y)=>(x.at||0)-(y.at||0))){
    const chip = o.paid?`<span class="chip">Đã nhận</span>`:o.paidClaim?`<span class="chip wait">Báo đã chuyển</span>`:`<span class="chip no">Chưa trả</span>`;
    h+=`<li class="person"><b>${esc(o.name||"Đồng nghiệp")}</b><span class="r num"><b>${money(o.total)}</b></span>
      <small>${o.items.map(i=>`${i.qty} ${esc(i.name)}`).join(", ")}${o.note?`. Ghi chú: ${esc(o.note)}`:""}</small>
      <span class="r">${S.isAdmin?`<button class="btn ${o.paid?"ghost ":""}small" data-act="togglePaid" data-uid="${esc(o.uid)}">${o.paid?"Bỏ xác nhận":"Đã nhận tiền"}</button>`:chip}</span>
      ${S.isAdmin?`<small>${chip}</small>`:""}
    </li>`;
  }
  return h+`</ul>`;
}
/* ---------- nhắc qua email (admin) ---------- */
function people(){
  // Người đã đăng nhập (users, chỉ admin đọc được), bỏ admin đang dùng
  const m={};
  for(const [uid,d] of Object.entries(S.users)) if(d?.email) m[uid]={uid,name:String(d.name||d.email),email:String(d.email)};
  delete m[S.uid];
  return Object.values(m).sort((a,b)=>a.name.localeCompare(b.name,"vi"));
}
function remindTargets(who){
  const all=people(), done=new Set(todayOrders().map(o=>o.uid));
  return who==="all" ? all : all.filter(p=>!done.has(p.uid));
}
function openGmail(list){
  if(!list.length){ toast("Không có ai để gửi"); return; }
  const t=S.today, dd=`${String(t.d).padStart(2,"0")}/${String(t.m).padStart(2,"0")}`;
  const su=`Nhắc đặt cơm trưa ${dd}`;
  const body=`Chào mọi người,\n\nMenu cơm trưa hôm nay có rồi. Ai chưa chọn món thì vào chọn trước ${S.settings?.deadline||"10:30"} nhé:\n${location.origin+location.pathname}\n\nCảm ơn mọi người.`;
  const q=new URLSearchParams({view:"cm",fs:"1",bcc:list.map(x=>x.email).join(","),su,body,authuser:S.authUser?.email||""});
  window.open(`https://mail.google.com/mail/?${q}`,"_blank","noopener");
}
function remindPanel(){
  if(!S.isAdmin || !S.menu) return "";
  const all=people(), todo=remindTargets("todo");
  if(!all.length) return `<section class="remind"><p class="hint" style="margin:0">Chưa có email nào. Mọi người cần đăng nhập vào app ít nhất một lần thì mới gửi nhắc được.</p></section>`;
  const names=todo.slice(0,6).map(p=>esc(p.name.split(" ").slice(-1)[0])).join(", ")+(todo.length>6?` và ${todo.length-6} người khác`:"");
  return `<section class="remind">
    <p class="r-title">${todo.length?`<b>${todo.length}</b> người chưa đặt`:"Mọi người đều đã đặt"}<span> / ${all.length} người đã đăng nhập</span></p>
    ${todo.length?`<p class="hint">${names}</p>`:""}
    <div class="row">
      ${todo.length?`<button class="btn" data-act="mailRemind" data-who="todo">Gửi email nhắc ${todo.length} người</button>`:""}
      <button class="btn ghost" data-act="mailRemind" data-who="all">Gửi tất cả</button>
      <button class="link" data-act="copyEmails" data-who="${todo.length?"todo":"all"}">Chép email</button>
    </div>
  </section>`;
}
function storeMessage(){
  const a=aggregate(), t=S.today;
  let s=`Chào quán, văn phòng đặt cơm trưa ngày ${String(t.d).padStart(2,"0")}/${String(t.m).padStart(2,"0")}:\n`;
  for(const d of a.dishes) s+=`- ${d.name}: ${d.qty} phần\n`;
  s+=`Tổng cộng: ${a.portions} phần (${money(a.total)}).`;
  const notes=a.list.filter(o=>o.note).map(o=>`- ${o.items.map(i=>`${i.qty} ${i.name}`).join(", ")}: ${o.note}`);
  if(notes.length) s+=`\nGhi chú:\n${notes.join("\n")}`;
  return s;
}
function sheetRows(){
  const a=aggregate();
  const rows=[["Tổng hợp đặt cơm ngày",dayKey()],[],["Món","Số lượng","Đơn giá","Thành tiền"]];
  a.dishes.forEach(d=>rows.push([d.name,d.qty,d.price,d.qty*d.price]));
  rows.push(["Tổng",a.portions,"",a.total],[],["Người đặt","Món","Ghi chú","Tiền","Thanh toán"]);
  a.list.forEach(o=>rows.push([o.name||"",o.items.map(i=>`${i.qty} ${i.name}`).join("; "),o.note||"",o.total,o.paid?"Đã nhận":o.paidClaim?"Báo đã chuyển":"Chưa trả"]));
  return rows;
}
/* Nạp thư viện ngoài có kiểm tra SRI (file bị sửa trên CDN sẽ không chạy) */
function loadScript(src,integrity){
  return new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src=src; s.integrity=integrity; s.crossOrigin="anonymous"; s.referrerPolicy="no-referrer";
    s.onload=res; s.onerror=()=>{ s.remove(); rej(new Error("Không tải được "+src)); };
    document.head.appendChild(s);
  });
}
let xlsxP=null;
async function downloadCsv(){
  xlsxP ||= loadScript("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js","sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT").catch(e=>{ xlsxP=null; throw e; });
  await xlsxP;
  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet(sheetRows());
  ws["!cols"] = [{wch:26},{wch:34},{wch:20},{wch:12},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Đặt cơm");
  XLSX.writeFile(wb, `dat-com-${dayKey()}.xlsx`);
}
const remindMessage = () => `Menu cơm trưa hôm nay có rồi, mọi người chọn món trước ${S.settings?.deadline||"10:30"} nhé:\n${location.origin+location.pathname}`;

/* ---------- admin tab ---------- */
function adminView(){
  if(!S.isAdmin) return `<p class="hint">Chỉ admin mới vào được mục này.</p>`;
  if(!S.draftDirty) S.draft={ items:(S.menu?.items||[]).map(i=>({...i})), note:S.menu?.note||"" };
  // imgDraft=null nghĩa là chưa đụng tới ảnh: hiện ảnh đang có, khi đăng menu không ghi lại ảnh
  if(S.menu && !currentImages()) loadImages();
  const shownImgs=S.imgDraft ?? currentImages() ?? [];
  if(!S.setDirty) S.setDraft={ bankBin:S.settings?.bankBin||"", accountNo:S.settings?.accountNo||"", accountName:S.settings?.accountName||"", deadline:S.settings?.deadline||"10:30" };
  const d=S.draft, st=S.menu?.status||"auto", sd=S.setDraft;
  let h=`<h2>Menu hôm nay</h2><p class="hint">Dán menu dạng chữ (mỗi món một dòng, có giá) rồi bấm Đọc menu. Có thể đính kèm ảnh menu để mọi người xem.</p>`;
  h+=`<label class="field" for="menuText">Menu dạng chữ</label><textarea id="menuText" placeholder="Cơm gà xối mỡ 35k&#10;Cơm sườn bì chả 40.000&#10;Bún bò 45k"></textarea>`;
  h+=`<div class="row" style="margin-top:10px"><button class="btn ghost" data-act="parse">Đọc menu</button></div>`;
  h+=`<div class="drop"><label class="btn ghost" for="imgIn" style="cursor:pointer">Đính kèm ảnh menu</label><input id="imgIn" type="file" accept="image/*" multiple hidden>
    <div class="thumbs">${imgsHtml(shownImgs,"Ảnh")}</div>
    ${shownImgs.length?`<button class="link" data-act="clearImgs">Xoá ảnh</button>`:""}</div>`;
  h+=`<h2>Danh sách món</h2>`;
  if(!d.items.length) h+=`<p class="hint">Chưa có món nào. Đọc menu ở trên hoặc thêm tay.</p>`;
  d.items.forEach((it,i)=>{ h+=`<div class="edit-row" data-i="${i}"><input type="text" data-f="name" value="${esc(it.name)}" placeholder="Tên món" aria-label="Tên món"><input type="number" data-f="price" value="${esc(it.price)}" min="0" step="1000" placeholder="Giá" aria-label="Giá"><button class="icon-btn" data-act="delRow" aria-label="Xoá món">×</button></div>`; });
  h+=`<button class="link" data-act="addRow">+ Thêm món</button>`;
  h+=`<label class="field" for="menuNote">Lời nhắn kèm menu (không bắt buộc)</label><input type="text" id="menuNote" value="${esc(d.note)}" placeholder="Hôm nay quán có thêm canh chua miễn phí">`;
  h+=`<div class="row" style="margin-top:16px"><button class="btn" data-act="publishMenu" ${S.busy?"disabled":""}>${S.menu?"Cập nhật menu":"Đăng menu"}</button>${S.menu?`<button class="btn ghost" data-act="copyRemind">Chép tin nhắc</button>`:""}</div>`;
  if(S.menu) h+=`<h2>Nhận đơn</h2><div class="seg" role="group" aria-label="Trạng thái nhận đơn">
      <button data-act="status" data-v="auto" aria-pressed="${st==="auto"}">Tự chốt lúc ${esc(S.settings?.deadline||"10:30")}</button>
      <button data-act="status" data-v="open" aria-pressed="${st==="open"}">Mở thêm giờ</button>
      <button data-act="status" data-v="closed" aria-pressed="${st==="closed"}">Chốt ngay</button></div>`;
  h+=`<h2>Tài khoản nhận tiền</h2><p class="hint">Dùng để tạo mã VietQR có sẵn số tiền cho từng người.</p>
    <label class="field" for="bank">Ngân hàng</label>
    <select id="bank" data-s="bankBin"><option value="">Chọn ngân hàng</option>${BANKS.map(b=>`<option value="${b[1]}" ${b[1]===sd.bankBin?"selected":""}>${esc(b[0])}</option>`).join("")}</select>
    <label class="field" for="acc">Số tài khoản</label><input id="acc" type="text" inputmode="numeric" data-s="accountNo" value="${esc(sd.accountNo)}">
    <label class="field" for="accName">Tên chủ tài khoản</label><input id="accName" type="text" data-s="accountName" value="${esc(sd.accountName)}" placeholder="NGUYEN VAN A">
    <label class="field" for="dl">Giờ chốt đơn mỗi ngày</label><input id="dl" type="time" data-s="deadline" value="${esc(sd.deadline)}">
    <div class="row" style="margin-top:16px"><button class="btn" data-act="saveSettings">Lưu cài đặt</button></div>`;
  return h;
}

/* ---------- events ---------- */
$("#view").addEventListener("input",e=>{
  const t=e.target;
  if(t.id==="note"){ S.note=t.value; S.cartDirty=true; updateBar(); }
  if(t.closest(".edit-row")){ const i=+t.closest(".edit-row").dataset.i, f=t.dataset.f; S.draft.items[i][f]= f==="price"?(+t.value||0):t.value; S.draftDirty=true; }
  if(t.id==="menuNote"){ S.draft.note=t.value; S.draftDirty=true; }
  if(t.dataset.s){ S.setDraft[t.dataset.s]=t.value.trim(); S.setDirty=true; }
});
$("#view").addEventListener("change",async e=>{
  const t=e.target;
  if(t.dataset.s){ S.setDraft[t.dataset.s]=t.value.trim(); S.setDirty=true; }
  if(t.id==="imgIn"){
    try{
      const list=[...(S.imgDraft ?? currentImages() ?? [])];
      for(const f of [...t.files].slice(0,3)){ list.push(await compressImage(f)); }
      S.imgDraft=list.slice(-3);
      if(JSON.stringify(S.imgDraft).length>850000){ S.imgDraft=S.imgDraft.slice(-1); toast("Ảnh quá nặng, chỉ giữ ảnh cuối cùng"); }
    }catch(err){ toast("Không đọc được ảnh này"); }
    t.value=""; render();
  }
});
$("#view").addEventListener("click",async e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const act=b.dataset.act;
  try{
    if(act==="pick"){ const id=b.closest(".item").dataset.id; if(!S.cart[id]){ S.cart[id]=1; S.cartDirty=true; updateItemRow(id); updateBar(); } }
    else if(act==="inc"||act==="dec"){ const id=b.closest(".item").dataset.id; S.cart[id]=Math.max(0,(S.cart[id]||0)+(act==="inc"?1:-1)); S.cartDirty=true; updateItemRow(id); updateBar(); }
    else if(act==="signIn"){ await doSignIn(); }
    else if(act==="goAdmin"){ S.tab="admin"; render(); }
    else if(act==="claimPaid"){ await updateDoc(orderRef(S.uid),{paidClaim:true}); toast("Đã báo admin là bạn đã chuyển khoản"); }
    else if(act==="cancel"){ if(confirm("Huỷ đơn hôm nay?")){ await deleteDoc(orderRef(S.uid)); S.cartDirty=false; toast("Đã huỷ đơn"); } }
    else if(act==="copyAcc"){ copy(S.settings?.accountNo||""); }
    else if(act==="copyInfo"){ copy(b.dataset.v||""); }
    else if(act==="csv"){ await downloadCsv(); }
    else if(act==="copyStore"){ copy(storeMessage()); }
    else if(act==="copyRemind"){ copy(remindMessage()); }
    else if(act==="mailRemind"){ openGmail(remindTargets(b.dataset.who)); }
    else if(act==="copyEmails"){ const l=remindTargets(b.dataset.who); if(l.length) copy(l.map(x=>x.email).join(", ")); }
    else if(act==="togglePaid"){ const uid=b.dataset.uid, cur=S.orders[uid]; if(cur) await updateDoc(orderRef(uid),{paid:!cur.paid}); }
    else if(act==="addRow"){ S.draft.items.push({id:uidShort(),name:"",price:0}); S.draftDirty=true; render(); const r=document.querySelectorAll('.edit-row input[data-f="name"]'); r[r.length-1]?.focus(); }
    else if(act==="delRow"){ S.draft.items.splice(+b.closest(".edit-row").dataset.i,1); S.draftDirty=true; render(); }
    else if(act==="clearImgs"){ S.imgDraft=[]; render(); }
    else if(act==="parse"){ const items=parseMenuText($("#menuText").value); if(items.length){ S.draft.items=items; S.draftDirty=true; toast(`Đọc được ${items.length} món. Kiểm tra lại trước khi đăng.`); render(); } else toast("Không tìm thấy món có giá. Mỗi dòng cần có tên món và giá."); }
    else if(act==="publishMenu"){ await publishMenu(); }
    else if(act==="status"){ await setDoc(doc(fs,"menus",dayKey()),{status:b.dataset.v},{merge:true}); toast(b.dataset.v==="closed"?"Đã chốt đơn":b.dataset.v==="open"?"Đã mở thêm giờ đặt món":"Sẽ tự chốt theo giờ"); }
    else if(act==="saveSettings"){ await saveSettings(); }
    else if(act==="enablePush"){ await enablePush(); }
    else if(act==="hideNotify"){ lsSet("notifyHidden","1"); render(); }
  }catch(err){ handleErr(err); }
});
$("#barBtn").addEventListener("click",async()=>{
  const items=(S.menu?.items||[]).filter(i=>S.cart[i.id]>0).map(i=>({id:i.id,name:i.name,price:i.price,qty:S.cart[i.id]}));
  if(!items.length) return;
  const total=items.reduce((a,i)=>a+i.qty*i.price,0);
  S.busy=true; updateBar();
  try{
    await saveMine(prev=>({items,note:S.note.trim(),total,at:Date.now(),paidClaim:false,paid:S.isAdmin||(prev?.paid && prev.total===total)||false}));
    S.cartDirty=false; toast(S.isAdmin?"Đã đặt món":"Đã đặt món. Quét mã QR để chuyển khoản nhé"); render(); window.scrollTo({top:0,behavior:"smooth"});
  }catch(err){ handleErr(err); }
  S.busy=false; updateBar();
});
$("#signOut").addEventListener("click",()=>signOut(auth));
// "toggle" không nổi bọt nên bắt ở pha capture
$("#view").addEventListener("toggle",e=>{
  if(!e.target.matches?.("[data-photos]")) return;
  S.photosOpen=e.target.open; if(e.target.open) loadImages();
},true);
function handleErr(err){
  console.error(err);
  if(err?.code==="permission-denied") toast("Bạn không có quyền thao tác này.");
  else if(err?.code==="auth/popup-closed-by-user") {}
  else toast("Chưa lưu được, kiểm tra mạng rồi thử lại.");
}

/* ---------- writes ---------- */
async function saveMine(fn){
  const next=fn(myDay());
  if(next) await setDoc(orderRef(S.uid),{name:S.myName.slice(0,100),...next});
  else await deleteDoc(orderRef(S.uid));
}
async function publishMenu(){
  const items=S.draft.items.map(i=>({id:i.id||uidShort(),name:String(i.name||"").trim().slice(0,120),price:Math.max(0,Math.round(+i.price||0))})).filter(i=>i.name);
  if(!items.length){ toast("Thêm ít nhất một món có tên"); return; }
  S.busy=true; render();
  try{
    const day=dayKey(), b=writeBatch(fs);
    const imgs = S.imgDraft ?? currentImages();
    const menu={date:day,items,note:S.draft.note.trim().slice(0,300),status:S.menu?.status||"auto",postedAt:Date.now(),imageCount:imgs?imgs.length:(S.menu?.imageCount||0)};
    b.set(doc(fs,"menus",day),menu);
    // Ghi ảnh khi admin vừa đổi ảnh, hoặc chuyển menu kiểu cũ (ảnh trong doc menu) sang chỗ mới
    if(S.imgDraft || Array.isArray(S.menu?.images)) b.set(doc(fs,"menuImages",day),{images:imgs||[]});
    await b.commit();
    if(imgs){ S.images=imgs; S.imagesDay=day; }
    S.draftDirty=false; S.imgDraft=null; toast(S.menu?"Đã cập nhật menu":"Đã đăng menu");
  }catch(err){ handleErr(err); }
  S.busy=false; render();
}
async function saveSettings(){
  const sd=S.setDraft;
  if(sd.accountNo && !/^\d{4,19}$/.test(sd.accountNo)){ toast("Số tài khoản chỉ gồm chữ số"); return; }
  if(sd.bankBin && !BANKS.some(b=>b[1]===sd.bankBin)){ toast("Ngân hàng không hợp lệ"); return; }
  if(!/^\d{1,2}:\d{2}$/.test(sd.deadline||"")){ toast("Giờ chốt không hợp lệ"); return; }
  // deadlineMin dùng trong firestore.rules để chặn đặt/sửa đơn sau giờ chốt
  await setDoc(doc(fs,"config","settings"),{...sd,accountName:ascii(sd.accountName).slice(0,50),deadlineMin:parseHM(sd.deadline)});
  S.setDirty=false; toast("Đã lưu cài đặt");
}

/* ---------- auth & data ---------- */
async function doSignIn(){
  const p=new GoogleAuthProvider(); p.setCustomParameters({prompt:"select_account"});
  try{ await signInWithPopup(auth,p); }
  catch(err){ if(/popup-blocked|operation-not-supported/.test(err?.code||"")) await signInWithRedirect(auth,p); else throw err; }
}
let unsubs=[], dayUnsubs=[], unsubUsers=null;
// Chỉ nghe menu + đơn của ngày hôm nay (không tải lịch sử, không tải ảnh)
function subscribeDay(){
  dayUnsubs.forEach(u=>u()); dayUnsubs=[];
  const day=dayKey();
  S.menu=null; S.orders={}; S.images=null; S.imagesDay=null; S.photosOpen=false; S.loaded={menu:false,orders:false};
  dayUnsubs.push(onSnapshot(doc(fs,"menus",day),s=>{
    if(s.metadata.fromCache && !s.exists()) return;
    const prev=S.menu, wasLoaded=S.loaded.menu; S.menu=s.exists()?s.data():null; S.loaded.menu=true; S._locked=isLocked();
    // Đang mở app thì báo ngay khi admin vừa đăng menu (không báo lại cho chính admin)
    if(wasLoaded && !prev && S.menu && !s.metadata.hasPendingWrites && !S.isAdmin) announceMenu(S.menu);
    if(prev && prev.postedAt!==S.menu?.postedAt && S.imagesDay===day && !s.metadata.hasPendingWrites){ S.images=null; S.imagesDay=null; if(S.photosOpen) loadImages(); }
    safeRender();
  },err=>{ console.warn(err); S.loaded.menu=true; safeRender(); }));
  dayUnsubs.push(onSnapshot(collection(fs,"days",day,"orders"),s=>{
    if(s.metadata.fromCache && s.empty) return;
    const o={}; s.forEach(d=>o[d.id]=d.data()); S.orders=o; S.loaded.orders=true; safeRender();
  },err=>{ console.warn(err); S.loaded.orders=true; safeRender(); }));
}
function subscribeUsers(){
  unsubUsers?.();
  unsubUsers=onSnapshot(collection(fs,"users"),s=>{ const o={}; s.forEach(d=>o[d.id]=d.data()); S.users=o; safeRender(); },e=>console.warn("users:",e.code));
}
function startData(){
  unsubs.push(onSnapshot(doc(fs,"config","settings"),s=>{
    S.settings=s.exists()?s.data():null;
    // Cài đặt cũ chưa có deadlineMin (rules cần): admin tự bổ sung
    if(S.isAdmin && S.settings?.deadline && S.settings.deadlineMin==null) setDoc(doc(fs,"config","settings"),{deadlineMin:parseHM(S.settings.deadline)},{merge:true}).catch(e=>console.warn(e));
    safeRender();
  },e=>console.warn(e)));
  subscribeDay();
}
function stopData(){
  unsubs.forEach(u=>u()); unsubs=[]; dayUnsubs.forEach(u=>u()); dayUnsubs=[]; unsubUsers?.(); unsubUsers=null;
  S.orders={}; S.users={}; S.menu=null; S.settings=null; S.images=null; S.imagesDay=null; S.loaded={menu:false,orders:false};
}
const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const lsSet = (k,v) => { try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,v); }catch(e){} };
// Quyền admin do firestore.rules quyết định (collection admins). Ở đây chỉ để hiện/ẩn giao diện.
async function checkAdmin(u){
  const email=(u.email||"").toLowerCase(), key="adm:"+u.uid;
  if(lsGet(key)==="1") setAdmin(u,true); // hiện tab Quản lý ngay, không chờ mạng
  try{
    const s=await getDoc(doc(fs,"admins",email));
    setAdmin(u,s.exists()); lsSet(key,s.exists()?"1":null);
  }catch(e){ console.warn("admins:",e.code||e); }
}
function setAdmin(u,on){
  if(S.uid!==u.uid || S.isAdmin===on) return;
  S.isAdmin=on;
  if(on) subscribeUsers(); else { unsubUsers?.(); unsubUsers=null; S.users={}; if(S.tab==="admin") S.tab="order"; }
  safeRender();
}

/* ---------- PWA & thông báo ---------- */
// Service worker: cache để mở nhanh + nhận thông báo đẩy khi app đóng
const swReady = ("serviceWorker" in navigator)
  ? navigator.serviceWorker.register("./sw.js").catch(e=>{ console.warn("sw:",e); return null; })
  : Promise.resolve(null);
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
const pushCapable = () => "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
function pushState(){
  if(!VAPID_KEY) return "off";
  if(isIOS && !isStandalone()) return "ios-install"; // iPhone chỉ nhận thông báo khi đã thêm vào Màn hình chính
  if(!pushCapable()) return "unsupported";
  return Notification.permission; // default | granted | denied
}
function notifyPanel(){
  if(lsGet("notifyHidden")==="1") return "";
  const st=pushState();
  if(st==="ios-install") return `<section class="remind notify"><p class="r-title">Nhận thông báo khi có menu</p>
    <p class="hint">Trên iPhone: bấm nút <b>Chia sẻ</b> <span aria-hidden="true">⎋</span> ở thanh Safari → <b>Thêm vào Màn hình chính</b>. Mở app từ biểu tượng mới rồi bấm “Bật thông báo”.</p>
    <div class="row"><button class="link" data-act="hideNotify">Để sau</button></div></section>`;
  if(st==="default") return `<section class="remind notify"><p class="r-title">Nhận thông báo khi admin đăng menu</p>
    <div class="row"><button class="btn small" data-act="enablePush">Bật thông báo</button><button class="link" data-act="hideNotify">Để sau</button></div></section>`;
  return "";
}
let messagingP=null;
async function pushToken(){
  const reg=await swReady; if(!reg) throw new Error("no-sw");
  messagingP ||= import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js").then(async m=>{
    if(!(await m.isSupported())) throw new Error("unsupported");
    return m;
  });
  const m=await messagingP;
  await navigator.serviceWorker.ready;
  return m.getToken(m.getMessaging(app),{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
}
// Lưu token vào pushTokens/{token}: chỉ n8n (service account) đọc được, không ai khác thấy
async function saveToken(token){
  await setDoc(doc(fs,"pushTokens",token),{uid:S.uid,ua:navigator.userAgent.slice(0,200),updatedAt:Date.now()});
  lsSet("push:"+S.uid,S.today.key+"|"+token);
}
async function enablePush(){
  if(!pushCapable()){ toast("Trình duyệt này chưa hỗ trợ thông báo"); return; }
  const p=await Notification.requestPermission(); // phải gọi trực tiếp từ cú bấm (yêu cầu của iOS)
  if(p!=="granted"){ toast("Bạn chưa cho phép thông báo. Có thể bật lại trong Cài đặt."); render(); return; }
  try{ await saveToken(await pushToken()); toast("Đã bật thông báo"); }
  catch(e){ console.warn("push:",e); toast("Chưa bật được thông báo, thử lại sau"); }
  render();
}
// Token có thể đổi: mỗi ngày kiểm tra lại một lần
async function refreshPushToken(){
  if(pushState()!=="granted" || !S.uid) return;
  try{
    const t=await pushToken(), saved=lsGet("push:"+S.uid)||"";
    if(saved!==S.today.key+"|"+t) await saveToken(t);
  }catch(e){ console.warn("push:",e); }
}
async function announceMenu(menu){
  const body=(menu.items||[]).slice(0,4).map(i=>i.name).join(", ")+((menu.items||[]).length>4?"…":"");
  toast("Admin vừa đăng menu hôm nay");
  if(document.hidden && "Notification" in window && Notification.permission==="granted"){
    const reg=await swReady;
    reg?.showNotification("Menu cơm trưa hôm nay đã có",{body,icon:"icons/icon-192.png",tag:"menu"});
  }
}

if(configured){
  getRedirectResult(auth).catch(err=>console.warn(err));
  onAuthStateChanged(auth,async u=>{
    if(u && ALLOWED_DOMAIN && !(u.email||"").toLowerCase().endsWith("@"+ALLOWED_DOMAIN.toLowerCase())){
      toast(`Chỉ dùng được email @${ALLOWED_DOMAIN}`); await signOut(auth); return;
    }
    S.authReady=true; S.authUser=u||null;
    stopData();
    if(u){
      S.uid=u.uid; S.myName=(u.displayName||u.email||"Bạn").slice(0,100); S.isAdmin=false;
      startData();
      checkAdmin(u);
      refreshPushToken();
      // Ghi lại email để admin gửi nhắc, mỗi ngày tối đa một lần (đỡ tốn lượt ghi)
      const seenKey="seen:"+u.uid;
      if(lsGet(seenKey)!==S.today.key){
        setDoc(doc(fs,"users",u.uid),{name:S.myName,email:u.email||"",lastSeen:Date.now()}).then(()=>lsSet(seenKey,S.today.key)).catch(e=>console.warn("users:",e.code));
      }
    } else { S.uid=null; S.isAdmin=false; }
    render();
  });
}
render();
