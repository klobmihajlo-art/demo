
"use strict";

const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); } catch (_) {}

const API = String(window.APP_CONFIG?.API_BASE || "").replace(/\/$/, "");
const $ = id => document.getElementById(id);

const esc = value => String(value ?? "—").replace(
  /[&<>"']/g,
  c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c])
);

let token = null;
let user = null;
let keyPair = null;
let fingerprint = null;
let publicKeyB64 = null;

const DB_NAME = "mco-demo-sign-v2";
const STORE = "keys";

const isAdmin = () =>
  ["minister", "deputy"].includes(user?.role);

const ready = () =>
  user &&
  !user.password_change_required &&
  user.email_verified &&
  user.first_name &&
  user.last_name;

const roleName = r => ({
  minister: "Міністр цифрової освіти",
  deputy: "Заступник Міністра",
  user: "Користувач"
}[r] || r || "—");

const message = (id, content, error = false) => {
  const el = $(id);
  if (!el) return;

  el.classList.remove("hidden");
  el.innerHTML = `<div class="${error ? 'error' : 'success'}">${esc(content)}</div>`;
};

const render = (id, html) => {
  const el = $(id);
  if (el) {
    el.classList.remove("hidden");
    el.innerHTML = html;
  }
};

const formValues = form =>
  Object.fromEntries(new FormData(form).entries());

const setBusy = (form, busy) => {
  const b = form.querySelector('[type="submit"]');
  if (b) b.disabled = busy;
};

async function api(path, options = {}) {
  if (!API) {
    throw new Error("У config.js не вказано адресу API.");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(API + path, {
      ...options,
      headers
    });
  } catch (_) {
    throw new Error(
      "Не вдалося підключитися до сервера. Перевірте адресу API, мережу та CORS."
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    let detail = data?.detail;

    if (Array.isArray(detail)) {
      detail = detail.map(x => x.msg).join("; ");
    }

    if (
      response.status === 401 &&
      path !== "/api/auth/login"
    ) {
      token = null;
      user = null;
      show("login");
    }

    throw new Error(
      typeof detail === "string"
        ? detail
        : `Помилка сервера (${response.status}).`
    );
  }

  return data;
}

function show(id) {
  const screen = $(id);

  if (!screen) {
    console.warn("Сторінку не знайдено:", id);
    return;
  }

  document.querySelectorAll(".screen").forEach(el => {
    el.classList.toggle("active", el.id === id);
  });

  document.querySelectorAll("[data-go]").forEach(el => {
    el.classList.toggle("active", el.dataset.go === id);
  });

  window.scrollTo(0, 0);
}

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.go;

    if (!user && !["login", "verify"].includes(page)) {
      show("login");
      return;
    }

    if (page === "admin" && !isAdmin()) {
      alert("Недостатньо прав.");
      return;
    }

    show(page);

    if (page === "history") loadHistory();
    if (page === "documents") loadDocuments();
    if (page === "profile") loadProfile();
    if (page === "key") refreshKeyView();
    if (page === "admin") loadAdmin();
  });
});

function telegramInitData() {
  if (!tg?.initData) {
    throw new Error(
      "Для входу відкрийте застосунок через Telegram."
    );
  }

  return tg.initData;
}

async function loginAccount(login, password) {
  const result = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      login: login.trim(),
      password,
      init_data: telegramInitData()
    })
  });

  token = result.access_token;
  user = result.user;

  if (!token || !user) {
    throw new Error("Сервер не повернув дані авторизації.");
  }

  await afterLogin();
}

async function afterLogin() {
  if (user.password_change_required) {
    show("change-password");
    return;
  }

  if (!user.email_verified || !user.first_name || !user.last_name) {
    show("profile");
    if (typeof loadProfile === "function") loadProfile();
    return;
  }

  show("home");

  if (typeof refreshHome === "function") {
    await refreshHome();
  }
}

async function logoutAccount(all = false) {
  if (!token) {
    user = null;
    show("login");
    return;
  }

  const endpoint = all
    ? "/api/auth/logout-all"
    : "/api/auth/logout";

  try {
    await api(endpoint, { method: "POST" });
  } catch (error) {
    console.warn("Помилка виходу:", error.message);
  }

  token = null;
  user = null;
  keyPair = null;
  fingerprint = null;
  publicKeyB64 = null;

  show("login");
}

const loginForm = $("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    const fields = formValues(loginForm);
    setBusy(loginForm, true);

    try {
      await loginAccount(
        String(fields.login || ""),
        String(fields.password || "")
      );

      loginForm.reset();
    } catch (error) {
      message("loginResult", error.message, true);
    } finally {
      setBusy(loginForm, false);
    }
  });
}

const logoutButton = $("logoutBtn");

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    logoutAccount();
  });
}

async function refreshUser() {
  user = await api("/api/me");
  return user;
}

async function loadProfile() {
  if (!user) return;

  await refreshUser();

  const fields = {
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    email: user.email || "",
    birth_date: user.birth_date || "",
    position: user.position || ""
  };

  const form = $("profileForm");

  if (form) {
    for (const [name, value] of Object.entries(fields)) {
      const input = form.elements.namedItem(name);
      if (input) input.value = value;
    }

    const locked = Boolean(user.email_verified);

    for (const input of form.elements) {
      if (input.name) input.disabled = locked;
    }
  }

  render("profileInfo", `
    <div class="data-row">
      <span>Telegram ID</span>
      <b>${esc(user.telegram_id)}</b>
    </div>
    <div class="data-row">
      <span>Логін</span>
      <b>${esc(user.login)}</b>
    </div>
    <div class="data-row">
      <span>Посада</span>
      <b>${esc(roleName(user.role))}</b>
    </div>
    <div class="data-row">
      <span>Електронна пошта</span>
      <b>${user.email_verified ? "Підтверджено" : "Не підтверджено"}</b>
    </div>
  `);
}

const profileForm = $("profileForm");

if (profileForm) {
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(profileForm, true);

    try {
      const f = formValues(profileForm);

      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify({
          first_name: String(f.first_name || "").trim(),
          last_name: String(f.last_name || "").trim(),
          email: String(f.email || "").trim(),
          birth_date: f.birth_date || null,
          position: f.position || null
        })
      });

      await loadProfile();
      message("profileResult", "Профіль збережено.");
    } catch (error) {
      message("profileResult", error.message, true);
    } finally {
      setBusy(profileForm, false);
    }
  });
}

const sendEmailCodeBtn = $("sendEmailCodeBtn");

if (sendEmailCodeBtn) {
  sendEmailCodeBtn.addEventListener("click", async () => {
    sendEmailCodeBtn.disabled = true;

    try {
      const result = await api(
        "/api/profile/send-email-code",
        { method: "POST" }
      );

      message(
        "emailResult",
        result.message || "Код надіслано на електронну пошту."
      );
    } catch (error) {
      message("emailResult", error.message, true);
    } finally {
      sendEmailCodeBtn.disabled = false;
    }
  });
}

const emailVerifyForm = $("emailVerifyForm");

if (emailVerifyForm) {
  emailVerifyForm.addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(emailVerifyForm, true);

    try {
      const f = formValues(emailVerifyForm);

      await api("/api/profile/verify-email", {
        method: "POST",
        body: JSON.stringify({
          code: String(f.code || "").trim()
        })
      });

      await refreshUser();

      message("emailResult", "Електронну пошту підтверджено.");

      await afterLogin();
    } catch (error) {
      message("emailResult", error.message, true);
    } finally {
      setBusy(emailVerifyForm, false);
    }
  });
}

const changePasswordForm = $("changePasswordForm");

if (changePasswordForm) {
  changePasswordForm.addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(changePasswordForm, true);

    try {
      const f = formValues(changePasswordForm);

      const result = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: String(f.current_password || ""),
          new_password: String(f.new_password || "")
        })
      });

      token = null;
      user = null;
      changePasswordForm.reset();

      show("login");

      message(
        "loginResult",
        result.message || "Пароль змінено. Увійдіть повторно."
      );
    } catch (error) {
      message("changePasswordResult", error.message, true);
    } finally {
      setBusy(changePasswordForm, false);
    }
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeKey(pair) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(pair, user.telegram_id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readKey() {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(user.telegram_id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function b64(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = "";

  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }

  return btoa(result);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadLocalKey() {
  if (!crypto?.subtle) {
    throw new Error(
      "Браузер не підтримує Web Crypto. Потрібен HTTPS."
    );
  }

  keyPair = await readKey();

  if (!keyPair) {
    fingerprint = null;
    publicKeyB64 = null;
    return false;
  }

  const publicKey = await crypto.subtle.exportKey(
    "spki",
    keyPair.publicKey
  );

  publicKeyB64 = b64(publicKey);

  fingerprint = hex(
    await crypto.subtle.digest("SHA-256", publicKey)
  );

  return true;
}

async function createPersonalKey() {
  if (!ready()) {
    throw new Error(
      "Спочатку заповніть профіль і підтвердьте email."
    );
  }

  const server = await api("/api/my/key");

  if (server.found) {
    throw new Error(
      "Активний ключ уже зареєстрований. Повторне створення заборонено."
    );
  }

  if (!crypto?.subtle) {
    throw new Error("Web Crypto недоступний.");
  }

  const pair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign", "verify"]
  );

  const exported = await crypto.subtle.exportKey(
    "spki",
    pair.publicKey
  );

  const encoded = b64(exported);

  const hash = hex(
    await crypto.subtle.digest("SHA-256", exported)
  );

  await api("/api/key/register", {
    method: "POST",
    body: JSON.stringify({
      public_key: encoded,
      fingerprint: hash
    })
  });

  await storeKey(pair);

  keyPair = pair;
  publicKeyB64 = encoded;
  fingerprint = hash;

  await refreshKeyView();
}

async function refreshKeyView() {
  if (!user) return;

  try {
    const server = await api("/api/my/key");
    const local = await loadLocalKey();

    if (!server.found) {
      render(
        "keyStatusDetail",
        "Особистий ключ ще не створено."
      );
      return;
    }

    if (!local || fingerprint !== server.key.fingerprint) {
      render(
        "keyStatusDetail",
        "Ключ зареєстровано, але його приватна частина недоступна на цьому пристрої."
      );
      return;
    }

    render(
      "keyStatusDetail",
      "Активний демонстраційний ключ ECDSA P-256"
    );

    render(
      "fingerprintFull",
      esc(fingerprint)
    );
  } catch (error) {
    render(
      "keyStatusDetail",
      `<span class="error">${esc(error.message)}</span>`
    );
  }
}

async function refreshHome() {
  if (!user) return;

  try {
    const server = await api("/api/my/key");
    const local = await loadLocalKey();

    const active = server.found &&
      local &&
      fingerprint === server.key.fingerprint;

    render(
      "keyStatus",
      active
        ? "Особистий ключ активний"
        : server.found
          ? "Приватний ключ недоступний на цьому пристрої"
          : "Особистий ключ ще не створено"
    );

    render(
      "fingerprintShort",
      active
        ? "SHA-256 · " + fingerprint.slice(0, 24) + "…"
        : "Ключ потребує налаштування"
    );
  } catch (error) {
    render("keyStatus", esc(error.message));
  }
}

async function handleCreateKey() {
  try {
    await createPersonalKey();
    alert("Особистий демонстраційний ключ створено.");
  } catch (error) {
    alert(error.message);
  }
}

["createKeyBtn", "createKeyBtn2"].forEach(id => {
  const button = $(id);

  if (button) {
    button.addEventListener("click", handleCreateKey);
  }
});

function canonicalPayload(obj) {
  const sorted = Object.fromEntries(
    Object.keys(obj).sort().map(key => [key, obj[key]])
  );

  return JSON.stringify(sorted);
}

function verificationUrl(identifier) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("verify", identifier);
  return url.toString();
}

function drawQR(element, value) {
  if (!element) return;

  element.innerHTML = "";

  if (typeof QRCode === "undefined") {
    element.textContent = "Бібліотека QR-кодів недоступна.";
    return;
  }

  new QRCode(element, {
    text: value,
    width: 180,
    height: 180
  });
}

async function signDocument(form) {
  if (!ready()) {
    throw new Error(
      "Спочатку завершіть налаштування профілю."
    );
  }

  const serverKey = await api("/api/my/key");
  const hasLocalKey = await loadLocalKey();

  if (!serverKey.found) {
    throw new Error("Спочатку створіть особистий ключ.");
  }

  if (
    !hasLocalKey ||
    fingerprint !== serverKey.key.fingerprint
  ) {
    throw new Error(
      "Приватний ключ недоступний на цьому пристрої."
    );
  }

  const fields = formValues(form);

  const payload = {
    document_number: String(
      fields.document_number || ""
    ).trim(),
    title: String(fields.title || "").trim(),
    description: String(fields.description || "").trim(),
    signer_name: (
      user.first_name + " " + user.last_name
    ).trim(),
    signer_position: user.position || roleName(user.role),
    issued_at: new Date().toISOString(),
    key_fingerprint: fingerprint
  };

  if (!payload.document_number || !payload.title) {
    throw new Error(
      "Укажіть номер і назву документа."
    );
  }

  const bytes = new TextEncoder().encode(
    canonicalPayload(payload)
  );

  const signed = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    keyPair.privateKey,
    bytes
  );

  const result = await api("/api/signatures", {
    method: "POST",
    body: JSON.stringify({
      payload,
      signature: b64(signed)
    })
  });

  const identifier = result.registration_number || result.id;
  const url = verificationUrl(identifier);

  render("signResult", `
    <div class="success">Підпис успішно створено</div>

    <div class="data-row">
      <span>Реєстраційний номер</span>
      <b>${esc(identifier)}</b>
    </div>

    <div class="data-row">
      <span>Номер документа</span>
      <b>${esc(payload.document_number)}</b>
    </div>

    <div class="data-row">
      <span>Назва документа</span>
      <b>${esc(payload.title)}</b>
    </div>

    <div class="data-row">
      <span>Статус</span>
      <b>Дійсний демонстраційний підпис</b>
    </div>

    <div class="qr" id="qrBox"></div>

    <p class="muted">
      QR-код відкриває сторінку перевірки підпису.
    </p>

    <button class="btn" id="printBtn" type="button">
      Друкувати картку
    </button>
  `);

  drawQR($("qrBox"), url);

  const printButton = $("printBtn");

  if (printButton) {
    printButton.onclick = () => {
      printSignatureCard(payload, result, url);
    };
  }

  form.reset();
}

const signForm = $("signForm");

if (signForm) {
  signForm.addEventListener("submit", async event => {
    event.preventDefault();
    setBusy(signForm, true);

    render("signResult", "Створюємо підпис…");

    try {
      await signDocument(signForm);
    } catch (error) {
      message("signResult", error.message, true);
    } finally {
      setBusy(signForm, false);
    }
  });
}

function printSignatureCard(payload, result, url) {
  const win = window.open("", "_blank");

  if (!win) {
    alert("Дозвольте відкривати вікна для друку.");
    return;
  }

  const rows = [
    ["Реєстраційний номер", result.registration_number],
    ["Номер документа", payload.document_number],
    ["Назва документа", payload.title],
    ["Підписувач", payload.signer_name],
    ["Посада", payload.signer_position],
    ["Дата створення", payload.issued_at],
    ["Відбиток ключа", result.fingerprint]
  ];

  win.document.write(`
    <!doctype html>
    <html lang="uk">
    <head>
      <meta charset="utf-8">
      <title>Картка підпису</title>
      <style>
        body {
          font: 15px Arial, sans-serif;
          max-width: 700px;
          margin: 30px auto;
          padding: 20px;
          color: #17314b;
        }
        h1 { font-size: 25px; }
        .row {
          padding: 12px 0;
          border-bottom: 1px solid #ddd;
        }
        .label {
          color: #65768a;
          font-size: 12px;
          margin-bottom: 5px;
        }
        #printQR { margin: 25px 0; }
        footer {
          margin-top: 30px;
          color: #876315;
        }
      </style>
    </head>
    <body>
      <h1>МЦО — Е-ПІДПИС</h1>
      <p>Картка демонстраційного електронного підпису</p>

      ${rows.map(([label, value]) => `
        <div class="row">
          <div class="label">${esc(label)}</div>
          <strong>${esc(value)}</strong>
        </div>
      `).join("")}

      <div id="printQR"></div>
      <p>Перевірка: ${esc(url)}</p>

      <footer>
        Демонстраційна система. Не є державним КЕП.
      </footer>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
      <script>
        window.onload = function() {
          if (window.QRCode) {
            new QRCode(document.getElementById("printQR"), {
              text: ${JSON.stringify(url)},
              width: 180,
              height: 180
            });
          }
          setTimeout(() => window.print(), 400);
        };
      <\/script>
    </body>
    </html>
  `);

  win.document.close();
}

async function verifyById(identifier) {
  const id = String(identifier || "").trim();

  if (!id) {
    message("verifyResult", "Укажіть номер підпису.", true);
    return;
  }

  render("verifyResult", "<p>Перевіряємо підпис…</p>");

  try {
    const r = await api(
      "/api/signatures/" + encodeURIComponent(id)
    );

    const valid = r.valid === true;

    render("verifyResult", `
      <div class="${valid ? "success" : "error"}">
        ${valid ? "ПІДПИС ДІЙСНИЙ" : "ПІДПИС НЕДІЙСНИЙ"}
      </div>

      <div class="data-row">
        <span>Реєстраційний номер</span>
        <b>${esc(r.registration_number)}</b>
      </div>

      <div class="data-row">
        <span>Статус</span>
        <b>${esc(r.message)}</b>
      </div>

      <div class="data-row">
        <span>Дата створення</span>
        <b>${esc(r.created_at)}</b>
      </div>

      <div class="data-row">
        <span>Відбиток ключа</span>
        <b>${esc(r.fingerprint)}</b>
      </div>

      ${r.annulled_at ? `
        <div class="data-row">
          <span>Дата анулювання</span>
          <b>${esc(r.annulled_at)}</b>
        </div>
      ` : ""}

      <p class="muted">${esc(r.disclaimer)}</p>
    `);
  } catch (error) {
    message("verifyResult", error.message, true);
  }
}

const verifyForm = $("verifyForm");

if (verifyForm) {
  verifyForm.addEventListener("submit", event => {
    event.preventDefault();
    verifyById($("verifyId")?.value);
  });
}

async function loadHistory() {
  render("historyList", "<p>Завантаження історії…</p>");

  try {
    const rows = await api("/api/my/signatures");

    if (!rows.length) {
      render(
        "historyList",
        "<p class='muted'>Підписів поки немає.</p>"
      );
      return;
    }

    render("historyList", rows.map(r => `
      <div class="list-item">
        <b>${esc(r.payload?.title)}</b>

        <p>Документ: ${esc(r.payload?.document_number)}</p>
        <p>Номер: ${esc(r.registration_number)}</p>
        <p>Статус: ${
          r.status === "valid" ? "Дійсний" : "Анульований"
        }</p>

        <button
          type="button"
          data-check="${esc(r.registration_number)}">
          Перевірити
        </button>

        ${r.status === "valid" ? `
          <button
            type="button"
            data-annul="${esc(r.id)}">
            Анулювати
          </button>
        ` : ""}
      </div>
    `).join(""));

    $("historyList")
      .querySelectorAll("[data-check]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const id = button.dataset.check;

          if ($("verifyId")) $("verifyId").value = id;

          show("verify");
          verifyById(id);
        });
      });

    $("historyList")
      .querySelectorAll("[data-annul]")
      .forEach(button => {
        button.addEventListener("click", () => {
          annulSignature(button.dataset.annul);
        });
      });
  } catch (error) {
    message("historyList", error.message, true);
  }
}

async function annulSignature(id) {
  const reason = prompt(
    "Укажіть причину анулювання підпису (не менше 5 символів):"
  );

  if (reason === null) return;

  if (reason.trim().length < 5) {
    alert("Причина повинна містити не менше 5 символів.");
    return;
  }

  if (!confirm("Підтвердити анулювання підпису?")) {
    return;
  }

  try {
    const result = await api(
      "/api/signatures/" + encodeURIComponent(id) + "/annul",
      {
        method: "POST",
        body: JSON.stringify({
          reason: reason.trim()
        })
      }
    );

    alert(
      "Підпис " + result.registration_number + " анульовано."
    );

    await loadHistory();
  } catch (error) {
    alert("Помилка анулювання: " + error.message);
  }
}

async function loadDocuments() {
  render(
    "documentsList",
    "<p class='muted'>Завантаження документів…</p>"
  );

  try {
    const documents = await api("/api/my/documents");

    if (!documents.length) {
      render(
        "documentsList",
        "<p class='muted'>Збережених документів поки немає.</p>"
      );
      return;
    }

    render(
      "documentsList",
      documents.map(doc => `
        <div class="list-item">
          <b>${esc(doc.title)}</b>

          <p class="muted">
            Додано: ${esc(doc.created_at)}
          </p>

          <p>
            <a
              href="${esc(doc.document_url)}"
              target="_blank"
              rel="noopener noreferrer">
              Відкрити документ у Google Drive
            </a>
          </p>

          <button
            type="button"
            data-delete-document="${esc(doc.id)}">
            Видалити з реєстру
          </button>
        </div>
      `).join("")
    );

    $("documentsList")
      .querySelectorAll("[data-delete-document]")
      .forEach(button => {
        button.addEventListener("click", () => {
          deleteDocument(button.dataset.deleteDocument);
        });
      });
  } catch (error) {
    message("documentsList", error.message, true);
  }
}

const documentForm = $("documentForm");

if (documentForm) {
  documentForm.addEventListener("submit", async event => {
    event.preventDefault();

    setBusy(documentForm, true);

    try {
      const fields = formValues(documentForm);

      const title = String(fields.title || "").trim();
      const documentUrl = String(
        fields.document_url || ""
      ).trim();

      if (!title || !documentUrl) {
        throw new Error(
          "Заповніть назву документа та посилання."
        );
      }

      const parsed = new URL(documentUrl);

      if (
        parsed.protocol !== "https:" ||
        !["drive.google.com", "docs.google.com"]
          .includes(parsed.hostname)
      ) {
        throw new Error(
          "Дозволені лише HTTPS-посилання Google Drive."
        );
      }

      await api("/api/my/documents", {
        method: "POST",
        body: JSON.stringify({
          title,
          document_url: documentUrl
        })
      });

      documentForm.reset();

      message(
        "documentResult",
        "Посилання на документ збережено."
      );

      await loadDocuments();
    } catch (error) {
      message("documentResult", error.message, true);
    } finally {
      setBusy(documentForm, false);
    }
  });
}

async function deleteDocument(documentId) {
  const confirmed = confirm(
    "Видалити посилання з реєстру МЦО? " +
    "Сам файл у Google Drive залишиться."
  );

  if (!confirmed) return;

  try {
    await api(
      "/api/my/documents/" +
      encodeURIComponent(documentId),
      { method: "DELETE" }
    );

    await loadDocuments();
  } catch (error) {
    alert(
      "Не вдалося видалити документ: " +
      error.message
    );
  }
}

const createUserForm = $("createUserForm");

if (createUserForm) {
  createUserForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!isAdmin()) {
      alert("Недостатньо прав для створення користувачів.");
      return;
    }

    setBusy(createUserForm, true);

    try {
      const body = formValues(createUserForm);

      if (user.role !== "minister") {
        body.role = "user";
      }

      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(body)
      });

      createUserForm.reset();

      message(
        "createUserResult",
        "Користувача створено. Передайте тимчасовий пароль безпечним способом."
      );

      await loadAdmin();
    } catch (error) {
      message("createUserResult", error.message, true);
    } finally {
      setBusy(createUserForm, false);
    }
  });
}

async function loadAdmin() {
  if (!isAdmin()) return;

  try {
    const [stats, users, audit] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
      api("/api/admin/audit")
    ]);

    render("adminStats", `
      <b>Статистика МЦО</b>

      <p>Користувачі: ${esc(stats.users)}</p>
      <p>Підписи: ${esc(stats.signatures)}</p>
      <p>Документи: ${esc(stats.documents)}</p>
      <p>Анульовані підписи: ${esc(stats.annulled_signatures)}</p>
    `);

    render(
      "adminUsers",
      users.length
        ? users.map(u => `
          <div class="list-item">
            <b>${esc(
              [u.first_name, u.last_name]
                .filter(Boolean)
                .join(" ") || u.login
            )}</b>

            <p>Telegram ID: ${esc(u.telegram_id)}</p>
            <p>Роль: ${esc(roleName(u.role))}</p>
            <p>Статус: ${esc(u.status)}</p>
            <p>Email: ${esc(u.email)}</p>

            <button
              type="button"
              data-edit="${esc(u.telegram_id)}">
              Редагувати
            </button>

            <button
              type="button"
              data-reset="${esc(u.telegram_id)}">
              Скинути пароль
            </button>
          </div>
        `).join("")
        : "<p class='muted'>Користувачів немає.</p>"
    );

    $("adminUsers")
      .querySelectorAll("[data-edit]")
      .forEach(button => {
        button.addEventListener("click", () => {
          editUser(button.dataset.edit, users);
        });
      });

    $("adminUsers")
      .querySelectorAll("[data-reset]")
      .forEach(button => {
        button.addEventListener("click", () => {
          resetUserPassword(button.dataset.reset);
        });
      });

    render(
      "adminAudit",
      audit.length
        ? audit.slice(0, 50).map(a => `
          <div class="list-item">
            <b>${esc(a.action)}</b>
            <p>${esc(a.created_at)}</p>
            <p>Виконавець: ${esc(a.actor_telegram_id)}</p>
            <p>Користувач: ${esc(a.target_telegram_id)}</p>
          </div>
        `).join("")
        : "<p class='muted'>Записів журналу немає.</p>"
    );
  } catch (error) {
    message("adminStats", error.message, true);
  }
}

async function editUser(id, users) {
  const target = users.find(u => u.telegram_id === id);

  if (!target) return;

  if (target.role === "minister") {
    alert("Профіль Міністра захищено.");
    return;
  }

  const position = prompt(
    "Нова посада:",
    target.position || ""
  );

  if (position === null) return;

  const status = prompt(
    "Статус: active або blocked",
    target.status
  );

  if (status === null) return;

  if (!["active", "blocked"].includes(status)) {
    alert("Недійсний статус.");
    return;
  }

  try {
    await api(
      "/api/admin/users/" + encodeURIComponent(id),
      {
        method: "PATCH",
        body: JSON.stringify({
          position,
          status
        })
      }
    );

    await loadAdmin();
  } catch (error) {
    alert(error.message);
  }
}

async function resetUserPassword(id) {
  const password = prompt(
    "Новий тимчасовий пароль (мінімум 12 символів):"
  );

  if (password === null) return;

  if (password.length < 12) {
    alert("Пароль надто короткий.");
    return;
  }

  if (!confirm(
    "Скинути пароль користувача? Усі його сеанси завершаться."
  )) {
    return;
  }

  try {
    await api(
      "/api/admin/users/" +
      encodeURIComponent(id) +
      "/reset-password",
      {
        method: "POST",
        body: JSON.stringify({
          temporary_password: password
        })
      }
    );

    alert("Пароль користувача скинуто.");
  } catch (error) {
    alert(error.message);
  }
}

const verifyFromUrl = new URLSearchParams(location.search).get("verify");

if (verifyFromUrl) {
  $("verifyId").value = verifyFromUrl;
  show("verify");
  verifyById(verifyFromUrl);
} else {
  show("login");
}
