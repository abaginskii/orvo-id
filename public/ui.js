// Shared pieces: API calls, the orvo mark, and the Telegram sign-in flow.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Нет связи с сервером. Проверьте интернет.'); e.status = res.status; throw e; }
  return data;
}

export const markSvg = `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="arc" d="M81.6 45A32 32 0 1 1 55 18.4"/><path class="seal" d="M55 18.4A32 32 0 0 1 81.6 45"/><circle class="dot" cx="72.6" cy="27.4" r="9"/></svg>`;
export const mark = (cls = '') => `<span class="mark ${cls}">${markSvg}</span>`;
// orvo plus: the same ring, the dot becomes a plus.
export const plusSvg = `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="arc" d="M81.6 45A32 32 0 1 1 55 18.4"/><path class="cross" d="M72.6 16.4v22M61.6 27.4h22"/></svg>`;
export const plusMark = (cls = '') => `<span class="mark ${cls}">${plusSvg}</span>`;

// Background light. Shader R behind the night sections, HorizonX Halo Drift on the light band.
// Both pause off screen and respect reduced motion; Halo is loaded only when its section comes near.
export function mountShaderR(canvas, colors = {}) {
  return import('./fx/shader-r.js').then(m => m.attachShaderR(canvas, {
    white: '#ffffff', dark: '#1A1322', orange: '#331971', scale: 1, distortion: .65, grain: .4, contrast: 1.08, speed: .7, animate: 'on', ...colors
  }, () => {})).catch(() => null);
}
export function mountHalo(canvas) {
  const start = () => import('./fx/halo.js').then(m => m.mountHaloDrift(canvas, { speed: .6, zoom: 1.15, exposure: 1, saturation: 1.1, vignette: .2, grain: .02 })).catch(() => null);
  if (!('IntersectionObserver' in window)) return start();
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '400px' });
  io.observe(canvas);
}
export function reveal(root = document) {
  const items = root.querySelectorAll('.rise');
  if (!('IntersectionObserver' in window)) return items.forEach(i => i.classList.add('in'));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  items.forEach(i => io.observe(i));
}
const tgIcon = `<svg class="tg-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.4 4.1 2.9 11.2c-1.3.5-1.3 1.2-.2 1.6l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.5c.3-1.3-.5-1.9-1.4-1.5ZM9.6 14.6l8.8-5.6c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.1-1.6-4.4Z"/></svg>`;

export function avatar(user, cls = '') {
  const initial = esc((user?.name || '?').trim()[0]?.toUpperCase() || '?');
  const img = user?.avatar ? `<img src="${esc(user.avatar)}" alt="" onerror="this.remove()">` : '';
  return `<span class="avatar ${cls}">${initial}${img}</span>`;
}

export function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function qrSvg(text) {
  if (!window.qrcode) return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Renders the Telegram sign-in into `root`. Calls onDone() after the session cookie is set.
// Inside the Telegram Mini App the page URL carries signed init data in the hash.
export function telegramInitData() {
  try { return new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') || window.Telegram?.WebApp?.initData || ''; } catch { return ''; }
}

export function loginFlow(root, { onDone, resume, title = 'Войти в orvo ID', sub = 'Пароль не нужен: вход подтверждается в Telegram.', after = 'Эта страница откроет профиль сама. Если аккаунта ещё нет, создадим его' } = {}) {
  let timer = null, tick = null, state = null, alive = true;
  const stop = () => { clearTimeout(timer); clearInterval(tick); };

  function idle(message) {
    stop();
    root.innerHTML = `<div class="flow">
      <div><h2>${esc(title)}</h2><p class="sub" style="margin:0">${esc(sub)}</p></div>
      ${message ? `<div class="note err" role="alert">${esc(message)}</div>` : ''}
      <button class="btn big wide" data-go>${tgIcon}<span>Войти через Telegram</span></button>
      <ol class="steps"><li>Откроется бот orvo ID в Telegram</li><li>Нажмите в нём «Войти»</li><li>${esc(after)}</li></ol>
    </div>`;
    root.querySelector('[data-go]').onclick = start;
  }

  async function start(e) {
    const btn = e?.currentTarget; if (btn) btn.disabled = true;
    try {
      state = await api('/api/login/start', { method: 'POST' });
      waiting();
      // tg:// opens the app without leaving this page (important inside an installed PWA).
      if (state.link && isPhone()) location.href = `tg://resolve?domain=${encodeURIComponent(state.bot)}&start=login_${state.code}`;
      else if (state.link) window.open(state.link, '_blank', 'noopener');
    } catch (err) { idle(err.message); }
  }

  function waiting() {
    const link = state.link;
    root.innerHTML = `<div class="flow">
      <div class="waiting">${mark('wait')}<div><h2>Подтвердите вход в Telegram</h2><p>Откройте бота и нажмите в нём «Войти». Ссылка действует <span class="timer" data-t>5:00</span></p></div></div>
      ${link ? `<a class="btn wide" href="${esc(link)}" target="_blank" rel="noopener">${tgIcon}<span>Открыть Telegram</span></a>
      <div class="qr"><div class="qr-img" aria-hidden="true">${qrSvg(link)}</div><p>Telegram на телефоне? Наведите камеру на код, и бот откроется там.</p></div>` : ''}
      ${state.dev ? '' : ''}
      <div class="row" style="justify-content:space-between">
        <button class="link" data-cancel>Отменить</button>
        ${window.__orvoDev ? '<button class="link" data-dev>Подтвердить без Telegram (разработка)</button>' : ''}
      </div>
    </div>`;
    root.querySelector('[data-cancel]').onclick = () => idle();
    root.querySelector('[data-dev]')?.addEventListener('click', () => api('/api/login/dev-approve', { method: 'POST', body: { code: state.code } }));
    const t = root.querySelector('[data-t]');
    tick = setInterval(() => {
      const left = Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000));
      t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }, 1000);
    poll();
  }

  async function poll() {
    if (!alive) return;
    try {
      const r = await api('/api/login/poll', { method: 'POST', body: { code: state.code, poll: state.poll } });
      if (r.status === 'pending') { timer = setTimeout(poll, document.hidden ? 3000 : 1500); return; }
      stop();
      if (r.status === 'done') return sealed(r.user);
      if (r.status === 'new') return createAccount(r.suggest);
      if (r.status === 'denied') return idle('Вход отклонён в Telegram.');
      return idle('Время вышло. Нажмите кнопку ещё раз.');
    } catch (err) {
      if (err.status === 404) return idle(err.message);
      timer = setTimeout(poll, 3000);
    }
  }

  function createAccount(s) {
    root.innerHTML = `<form class="flow form" novalidate>
      <div><h2>Создайте orvo ID</h2><p class="sub" style="margin:0">Telegram подтвердил, что это вы. Осталось выбрать, как вас называть.</p></div>
      <div class="newbie">${avatar({ name: s.name })}<div><b>${esc(s.name)}</b><br><small style="color:var(--muted)">${s.telegram ? 'Telegram @' + esc(s.telegram) : 'Telegram'}</small></div></div>
      <div class="field"><label for="f-name">Имя</label><div class="input"><input id="f-name" name="name" maxlength="48" required value="${esc(s.name)}" autocomplete="name"></div></div>
      <div class="field"><label for="f-user">Ник</label><div class="input"><span>@</span><input id="f-user" name="username" maxlength="24" required value="${esc(s.username)}" autocapitalize="off" spellcheck="false"></div><span class="hint">Латиница, цифры и _. Его увидят проекты, в которые вы войдёте.</span></div>
      <div class="note err" role="alert" hidden></div>
      <button class="btn big wide" type="submit">${mark()}<span>Создать orvo ID</span></button>
    </form>`;
    const form = root.querySelector('form');
    form.onsubmit = async ev => {
      ev.preventDefault();
      const btn = form.querySelector('button'); btn.disabled = true;
      const err = form.querySelector('.note');
      try {
        const r = await api('/api/login/create', { method: 'POST', body: { code: state.code, poll: state.poll, name: form.name.value, username: form.username.value } });
        sealed(r.user, true);
      } catch (e2) { err.hidden = false; err.textContent = e2.message; btn.disabled = false; }
    };
  }

  function sealed(user, created) {
    root.innerHTML = `<div class="flow center" style="justify-items:center;padding:12px 0">
      <span class="mark sealed" style="width:96px;height:96px">${markSvg}</span>
      <div><h2>${created ? 'orvo ID создан' : 'Вы вошли'}</h2><p class="sub" style="margin:0">${esc(user.name)}, @${esc(user.username)}</p></div>
    </div>`;
    setTimeout(() => onDone?.(user), 1100);
  }

  if (resume) { state = resume; root.innerHTML = `<div class="flow"><div class="waiting">${mark('wait')}<div><h2>Входим через Telegram</h2><p>Секунду…</p></div></div></div>`; poll(); }
  else idle();
  return { destroy() { alive = false; stop(); } };
}
