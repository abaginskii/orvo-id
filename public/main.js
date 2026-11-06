import { $, esc, api, mark, avatar, toast, loginFlow, telegramInitData } from './ui.js';
import { projects } from './projects.js';

const app = $('#app');
const nav = $('#nav');
let flow = null;

const date = iso => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const ago = iso => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 2) return 'сейчас';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return date(iso);
};

function projectRow(p, extra = '') {
  const tags = [
    p.orvoLogin ? `<span class="tag orvo">${mark()} Вход через orvo ID</span>` : '',
    p.status === 'soon' ? '<span class="tag soon">Скоро</span>' : '',
    p.isNew ? '<span class="tag new">Новое</span>' : ''
  ].join('');
  const action = extra || (p.url ? `<a class="open" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть</a>` : '<span></span>');
  return `<li class="project">
    ${p.icon ? `<img class="glyph" src="${esc(p.icon)}" alt="" aria-hidden="true">` : `<span class="glyph" style="background:${esc(p.color)}" aria-hidden="true">${esc(p.glyph)}</span>`}
    <div><h3>${esc(p.name)}</h3><p>${esc(p.about)}</p>${tags ? `<div class="meta">${tags}</div>` : ''}</div>
    ${action}
  </li>`;
}

function projectsSection() {
  return `<section class="section" id="projects" aria-labelledby="projects-title">
    <div class="section-head">
      <h2 class="title" id="projects-title">Проекты orvo</h2>
      <p>Всё, что сделано под знаком orvo. Где стоит отметка, можно войти тем же orvo ID.</p>
    </div>
    <ul class="projects">${projects.map(p => projectRow(p)).join('')}</ul>
  </section>`;
}

function renderLanding() {
  nav.innerHTML = '<a class="btn plain" href="#login">Войти</a>';
  app.innerHTML = `<section class="hero">
    <div>
      <div class="wordmark" aria-hidden="true">${mark('intro')}<span>orvo</span></div>
      <h1>Один аккаунт для всех проектов orvo</h1>
      <p class="lede">Войдите через Telegram или по коду из почты, и Сквозь, Kite, Полка и следующие проекты узнают вас без паролей.</p>
    </div>
    <div class="panel" id="login"></div>
  </section>
  ${projectsSection()}`;
  const initData = telegramInitData();
  const start = resume => { flow = loginFlow($('#login'), { resume, onDone: () => { history.replaceState(null, '', '/me'); boot(); } }); };
  if (initData) api('/api/login/webapp', { method: 'POST', body: { initData } }).then(start, () => start());
  else start();
}

async function renderProfile(data) {
  const { user, apps, sessions } = data;
  nav.innerHTML = `<button class="btn plain" data-logout>Выйти</button>`;
  const used = Object.fromEntries(apps.map(a => [a.id, a]));
  const rows = projects.map(p => {
    const g = used[p.id];
    const action = g
      ? `<div class="state">Вход ${ago(g.lastAt)}<br><button class="link" data-revoke="${esc(p.id)}">Отключить</button></div>`
      : p.url ? `<a class="open" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть</a>` : '<span></span>';
    return projectRow(p, action);
  }).join('');

  app.innerHTML = `<section class="me-hero">
    ${avatar(user)}
    <div>
      <h1>${esc(user.name)}</h1>
      <div class="ids"><span class="tag">@${esc(user.username)}</span>${user.telegram ? `<span class="tag">Telegram @${esc(user.telegram)}</span>` : ''}<span class="tag soon">С нами с ${date(user.createdAt)}</span></div>
    </div>
  </section>
  ${user.hasTelegram ? '' : `<div class="hint-card"><div><b>Входите в одно нажатие</b><p>Привяжите Telegram, и вводить код из письма больше не придётся.</p></div><button class="btn" data-link-tg>Привязать</button></div>`}
  <div class="grid2">
    <div>
      <section class="card" aria-labelledby="p-ways">
        <h2 id="p-ways">Способы входа</h2>
        <p>Если один недоступен, войдёте другим.</p>
        <div class="way"><div><b>Telegram</b><small>${user.hasTelegram ? (user.telegram ? '@' + esc(user.telegram) : 'Привязан') : 'Вход кнопкой в боте, без кода'}</small></div>${user.hasTelegram ? '<span class="ok">Привязан</span>' : '<button class="btn plain" data-link-tg>Привязать</button>'}</div>
        ${window.__orvoEmail === false && !user.email ? '' : `<div class="way"><div><b>Почта</b><small>${user.email ? esc(user.email) : 'Код на почту, если Telegram не открывается'}</small></div><button class="btn plain" data-mail-add>${user.email ? 'Изменить' : 'Добавить'}</button></div>`}
        <div data-way-box></div>
      </section>
      <section class="card" aria-labelledby="p-apps">
        <h2 id="p-apps">Проекты</h2>
        <p>Куда вы входили с orvo ID. Отключите проект, и при следующем входе он снова спросит разрешение.</p>
        <ul class="projects">${rows}</ul>
      </section>
    </div>
    <div>
      <section class="card" aria-labelledby="p-prof">
        <h2 id="p-prof">Профиль</h2>
        <p>Имя и ник видят проекты, в которые вы входите.</p>
        <form class="form" data-profile novalidate>
          <div class="field"><label for="p-name">Имя</label><div class="input"><input id="p-name" name="name" maxlength="48" value="${esc(user.name)}"></div></div>
          <div class="field"><label for="p-user">Ник</label><div class="input"><span>@</span><input id="p-user" name="username" maxlength="24" value="${esc(user.username)}" autocapitalize="off" spellcheck="false"></div></div>
          <div class="note err" role="alert" hidden></div>
          <div class="row"><button class="btn" type="submit">Сохранить</button></div>
        </form>
      </section>
      <section class="card" aria-labelledby="p-sess">
        <h2 id="p-sess">Где вы вошли</h2>
        <p>Завершите сеанс, если не узнаёте устройство.</p>
        ${sessions.map(s => `<div class="sess"><div><b>${esc(s.device)}</b><small>Вход ${date(s.createdAt)}, активность ${ago(s.lastAt)}</small></div>${s.current ? '<span class="here">Это устройство</span>' : `<button class="btn plain" data-end="${esc(s.id)}">Завершить</button>`}</div>`).join('')}
        ${sessions.length > 1 ? '<div class="row" style="margin-top:12px"><button class="link" data-end-all>Завершить все, кроме этого</button></div>' : ''}
      </section>
      <section class="card" aria-labelledby="p-del">
        <h2 id="p-del">Удалить orvo ID</h2>
        <p>Аккаунт и все входы будут удалены. Данные внутри Сквозь, Kite и Полки останутся в самих проектах.</p>
        <button class="btn danger" data-delete>Удалить аккаунт</button>
      </section>
    </div>
  </div>
  ${projectsSection()}`;

  // ----- ways in: add e-mail, link Telegram -----
  const box = $('[data-way-box]');
  app.querySelectorAll('[data-mail-add]').forEach(b => b.onclick = () => mailForm());
  function mailForm(message, email = '') {
    box.innerHTML = `<form class="form" novalidate style="margin-top:12px">
      <div class="field"><label for="w-mail">Почта</label><div class="input"><input id="w-mail" name="email" type="email" inputmode="email" autocomplete="email" value="${esc(email)}" placeholder="you@example.ru"></div></div>
      <div class="note err" role="alert" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <div class="row"><button class="btn" type="submit">Прислать код</button><button class="link" type="button" data-cancel>Отмена</button></div></form>`;
    const f = box.querySelector('form'); f.email.focus();
    box.querySelector('[data-cancel]').onclick = () => { box.innerHTML = ''; };
    f.onsubmit = async e => {
      e.preventDefault();
      const mail = f.email.value.trim();
      try { await api('/api/me/email/start', { method: 'POST', body: { email: mail } }); codeForm(mail); }
      catch (x) { mailForm(x.message, mail); }
    };
  }
  function codeForm(mail, message) {
    box.innerHTML = `<form class="form" novalidate style="margin-top:12px">
      <p style="margin:0">Код отправлен на <b>${esc(mail)}</b>.</p>
      <div class="field"><label for="w-code">Код из письма</label><div class="input"><input id="w-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="code-input"></div></div>
      <div class="note err" role="alert" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <div class="row"><button class="btn" type="submit">Подтвердить</button><button class="link" type="button" data-cancel>Отмена</button></div></form>`;
    const f = box.querySelector('form'); f.code.focus();
    box.querySelector('[data-cancel]').onclick = () => { box.innerHTML = ''; };
    f.code.addEventListener('input', () => { f.code.value = f.code.value.replace(/\D/g, '').slice(0, 6); if (f.code.value.length === 6) f.requestSubmit(); });
    f.onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/me/email/verify', { method: 'POST', body: { email: mail, code: f.code.value } }); toast('Почта привязана'); boot(); }
      catch (x) { codeForm(mail, x.message); }
    };
  }
  let linkTimer = null;
  app.querySelectorAll('[data-link-tg]').forEach(b => b.onclick = async () => {
    try {
      const st = await api('/api/me/telegram/start', { method: 'POST' });
      box.innerHTML = `<div class="hint-card" style="margin:12px 0 0"><div><b>Подтвердите в Telegram</b><p>Откройте бота orvo ID и нажмите «Привязать».</p></div>${st.link ? `<a class="btn" href="${esc(st.link)}" target="_blank" rel="noopener">Открыть</a>` : ''}</div>
        ${window.__orvoDev ? '<button class="link" data-dev-link>Подтвердить без Telegram (разработка)</button>' : ''}`;
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (st.link) window.open(st.link, '_blank', 'noopener');
      box.querySelector('[data-dev-link]')?.addEventListener('click', () => api('/api/login/dev-approve', { method: 'POST', body: { code: st.code, tgId: 200002, tgUsername: 'linked_dev' } }));
      const poll = async () => {
        try {
          const r = await api('/api/me/telegram/poll', { method: 'POST', body: { code: st.code, poll: st.poll } });
          if (r.status === 'pending') { linkTimer = setTimeout(poll, 1500); return; }
          if (r.status === 'done') { toast('Telegram привязан'); return boot(); }
          box.innerHTML = `<p class="note err">${r.status === 'denied' ? 'Привязка отклонена в Telegram.' : 'Время вышло. Попробуйте ещё раз.'}</p>`;
        } catch (x) { box.innerHTML = `<p class="note err">${esc(x.message)}</p>`; }
      };
      clearTimeout(linkTimer); poll();
    } catch (x) { toast(x.message); }
  });

  $('[data-logout]').onclick = async () => { await api('/api/logout', { method: 'POST' }); history.replaceState(null, '', '/'); boot(); };
  const form = $('[data-profile]');
  form.onsubmit = async e => {
    e.preventDefault();
    const err = form.querySelector('.note'); err.hidden = true;
    try {
      await api('/api/me', { method: 'PATCH', body: { name: form.name.value, username: form.username.value } });
      toast('Профиль сохранён'); boot();
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  };
  app.querySelectorAll('[data-end]').forEach(b => b.onclick = async () => { await api('/api/sessions/end', { method: 'POST', body: { id: b.dataset.end } }); toast('Сеанс завершён'); boot(); });
  $('[data-end-all]')?.addEventListener('click', async () => { await api('/api/sessions/end', { method: 'POST', body: { all: true } }); toast('Другие сеансы завершены'); boot(); });
  app.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => { await api('/api/apps/revoke', { method: 'POST', body: { id: b.dataset.revoke } }); toast('Проект отключён'); boot(); });
  $('[data-delete]').onclick = async () => {
    const answer = prompt(`Чтобы удалить orvo ID, введите свой ник: ${user.username}`);
    if (answer == null) return;
    try { await api('/api/me', { method: 'DELETE', body: { confirm: answer } }); history.replaceState(null, '', '/'); boot(); toast('orvo ID удалён'); }
    catch (x) { toast(x.message); }
  };
}

async function boot() {
  flow?.destroy(); flow = null;
  try {
    const data = await api('/api/me');
    if (location.pathname === '/') history.replaceState(null, '', '/me');
    renderProfile(data);
  } catch {
    if (location.pathname === '/me') history.replaceState(null, '', '/');
    renderLanding();
  }
  if (location.hash === '#projects') $('#projects')?.scrollIntoView();
}

api('/api/config').then(c => {
  window.__orvoDev = c.devLogin;
  window.__orvoEmail = c.email !== false;
  if (c.bot) $('#bot-link').innerHTML = `Бот: <a href="https://t.me/${esc(c.bot)}">@${esc(c.bot)}</a>`;
}).catch(() => {}).finally(boot);
