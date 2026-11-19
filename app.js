const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const API = (window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");
const $ = id => document.getElementById(id);
let keyPair = null, publicKeyB64 = null, fingerprint = null;
const DB_NAME = "mco-demo-sign", STORE = "keys";

function show(id) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active",s.id===id));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.go===id));
  if(id==="history") loadHistory();
  if(id==="key") refreshKeyView();
  window.scrollTo(0,0);
}
document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>show(b.dataset.go)));

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function storeKey(pair){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction(STORE,"readwrite");t.objectStore(STORE).put(pair,"personal");t.oncomplete=res;t.onerror=()=>rej(t.error);});}
async function readKey(){const d=await openDB();return new Promise((res,rej)=>{const r=d.transaction(STORE).objectStore(STORE).get("personal");r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}
function initData(){
  if (tg?.initData) return tg.initData;
  return "LOCAL_DEMO";
}
async function api(path,opts={}) {
  const headers={"Content-Type":"application/json","X-Telegram-Init-Data":initData(),...(opts.headers||{})};
  const res=await fetch(API+path,{...opts,headers});
  const data=await res.json().catch(()=>({detail:"Помилка відповіді сервера"}));
  if(!res.ok) throw new Error(data.detail||"Помилка сервера");
  return data;
}
function b64(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)));}
function hex(buf){return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function ensureKey(){
  if(!window.crypto?.subtle) throw new Error("Браузер не підтримує Web Crypto. Відкрий застосунок у Telegram через HTTPS.");
  keyPair=await readKey();
  if(!keyPair){
    keyPair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
    await storeKey(keyPair);
  }
  const spki=await crypto.subtle.exportKey("spki",keyPair.publicKey);
  publicKeyB64=b64(spki); fingerprint=hex(await crypto.subtle.digest("SHA-256",spki));
  await api("/api/key/register",{method:"POST",body:JSON.stringify({public_key:publicKeyB64,fingerprint})});
  updateKeyUI();
}
function updateKeyUI(){
  $("keyStatus").textContent="Особистий ключ активний";
  $("fingerprintShort").textContent="SHA-256 · "+fingerprint.slice(0,24)+"…";
  $("keyStatusDetail").textContent="Активний · ECDSA P-256";
  $("fingerprintFull").textContent=fingerprint;
}
function refreshKeyView(){if(fingerprint)updateKeyUI();}
async function boot(){
  const params=new URLSearchParams(location.search);
  const verify=params.get("verify");
  try{await ensureKey();}catch(e){$("keyStatus").textContent="Ключ не підключено";$("fingerprintShort").textContent=e.message;}
  if(verify){$("verifyId").value=verify;show("verify");verifyById(verify);}
}
async function createKey(){try{await ensureKey();alert("Особистий демонстраційний ключ готовий.");}catch(e){alert(e.message);}}
$("createKeyBtn").onclick=createKey;$("createKeyBtn2").onclick=createKey;

function canonicalPayload(obj){
  // Всі поля формуються в одному фіксованому наборі; сервер додатково канонізує JSON за ключами.
  return JSON.stringify(Object.fromEntries(Object.keys(obj).sort().map(k=>[k,obj[k]])));
}
$("signForm").addEventListener("submit",async e=>{
  e.preventDefault();const out=$("signResult");out.classList.remove("hidden");out.textContent="Створюємо та перевіряємо підпис…";
  try{
    if(!keyPair) await ensureKey();
    const f=new FormData(e.target);
    const payload={
      document_number:String(f.get("document_number")).trim(),
      title:String(f.get("title")).trim(),
      description:String(f.get("description")).trim(),
      signer_name:String(f.get("signer_name")).trim(),
      signer_position:String(f.get("signer_position")).trim(),
      issued_at:new Date().toISOString(),
      key_fingerprint:fingerprint
    };
    const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},keyPair.privateKey,new TextEncoder().encode(canonicalPayload(payload)));
    const result=await api("/api/signatures",{method:"POST",body:JSON.stringify({payload,signature:b64(signature)})});
    out.innerHTML=`<div class="success">✓ Підпис створено та перевірено сервером</div><div class="data-row"><span>НОМЕР ПІДПИСУ</span><b>${escapeHtml(result.id)}</b></div><div class="data-row"><span>НОМЕР ДОКУМЕНТА</span><b>${escapeHtml(payload.document_number)}</b></div><div class="data-row"><span>НАЗВА</span><b>${escapeHtml(payload.title)}</b></div><div class="data-row"><span>СТАТУС</span><b>Дійсний демонстраційний підпис</b></div><div class="qr" id="qrBox"></div><p class="muted">QR-код веде на сторінку публічної перевірки.</p><button class="btn" id="printBtn">Зберегти / надрукувати картку</button>`;
    const url=location.origin+location.pathname+"?verify="+encodeURIComponent(result.id);
    new QRCode($("qrBox"),{text:url,width:170,height:170});
    $("printBtn").onclick=()=>printCard(payload,result,url);
    e.target.reset();
  }catch(err){out.innerHTML=`<div class="error">Не вдалося створити підпис</div><p>${escapeHtml(err.message)}</p>`;}
});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function printCard(p,r,url){
 const w=window.open("","_blank");if(!w){alert("Дозволь відкривати вікна для друку.");return;}
 w.document.write(`<html><head><title>Картка підпису ${escapeHtml(r.id)}</title><style>body{font:15px Arial;padding:35px;color:#172b40;max-width:700px;margin:auto}h1{font-size:22px}small{color:#a66b12;font-weight:bold}.line{border-bottom:1px solid #ddd;padding:12px 0}.label{color:#667;font-size:11px;text-transform:uppercase;margin-bottom:5px}#qr{margin:25px auto;width:180px}footer{margin-top:30px;color:#a66b12;font-size:12px}</style></head><body><small>ДЕМОНСТРАЦІЙНА СИСТЕМА · НЕ Є КЕП</small><h1>Картка електронного підпису</h1>${[["Номер підпису",r.id],["Номер документа",p.document_number],["Назва документа",p.title],["Підписувач",p.signer_name],["Посада",p.signer_position],["Дата",p.issued_at],["SHA-256 ключа",r.fingerprint]].map(x=>`<div class="line"><div class="label">${escapeHtml(x[0])}</div><b>${escapeHtml(x[1])}</b></div>`).join("")}<div id="qr"></div><p>Перевірка: ${escapeHtml(url)}</p><footer>Цей запис підтверджує криптографічну перевірку в демонстраційній системі та не засвідчує державну сертифікацію особи.</footer><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script><script>new QRCode(document.getElementById('qr'),{text:${JSON.stringify(url)},width:180,height:180});window.onload=()=>window.print();<\/script></body></html>`);
 w.document.close();
}
$("verifyForm").addEventListener("submit",e=>{e.preventDefault();verifyById($("verifyId").value.trim());});
async function verifyById(id){
 const out=$("verifyResult");out.classList.remove("hidden");out.textContent="Перевіряємо запис…";
 try{
  const r=await api("/api/signatures/"+encodeURIComponent(id));
  const p=r.payload;
  out.innerHTML=`<div class="${r.valid?'success':'error'}">${r.valid?'✓ ПІДПИС ДІЙСНИЙ':'✕ ПЕРЕВІРКУ НЕ ПРОЙДЕНО'}</div><div class="data-row"><span>НОМЕР ПІДПИСУ</span><b>${escapeHtml(r.id)}</b></div><div class="data-row"><span>НОМЕР ДОКУМЕНТА</span><b>${escapeHtml(p.document_number)}</b></div><div class="data-row"><span>НАЗВА ДОКУМЕНТА</span><b>${escapeHtml(p.title)}</b></div><div class="data-row"><span>ПІДПИСУВАЧ</span><b>${escapeHtml(p.signer_name)} · ${escapeHtml(p.signer_position)}</b></div><div class="data-row"><span>ДАТА СТВОРЕННЯ</span><b>${escapeHtml(p.issued_at)}</b></div><div class="data-row"><span>ВІДКРИТИЙ ІДЕНТИФІКАТОР КЛЮЧА</span><b>${escapeHtml(r.fingerprint)}</b></div><p class="muted">Результат означає, що підпис відповідає збереженим полям і відкритому ключу. Це не державна сертифікація.</p>`;
 }catch(e){out.innerHTML=`<div class="error">Підпис не знайдено або перевірка недоступна</div><p>${escapeHtml(e.message)}</p>`;}
}
async function loadHistory(){
 const box=$("historyList");box.innerHTML='<p class="muted">Завантаження…</p>';
 try{
  const rows=await api("/api/my/signatures");
  if(!rows.length){box.innerHTML='<p class="muted">Підписаних документів поки немає.</p>';return;}
  box.innerHTML=rows.map(r=>`<div class="list-item"><b>${escapeHtml(r.payload.title)}</b><p>Документ: ${escapeHtml(r.payload.document_number)}</p><p>Підпис: ${escapeHtml(r.id)}</p><button data-check="${escapeHtml(r.id)}">Перевірити →</button></div>`).join("");
  box.querySelectorAll("[data-check]").forEach(b=>b.onclick=()=>{$("verifyId").value=b.dataset.check;show("verify");verifyById(b.dataset.check);});
 }catch(e){box.innerHTML=`<p class="error">${escapeHtml(e.message)}</p>`;}
}
boot();
