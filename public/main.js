import { $, esc, api, mark, avatar, toast, loginFlow } from './ui.js';
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
    p.status === 'soon' ? '<span class="tag soon">Скоро</span>' : ''
  ].join('');
  const action = extra || (p.url ? `<a class="open" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть</a>` : '<span></span>');
  return `<li class="project">
    <span class="glyph" style="background:${esc(p.color)}" aria-hidden="true">${esc(p.glyph)}</span>
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
      <p class="lede">Войдите один раз через Telegram, и Полка, Сквозь и следующие проекты узнают вас без паролей и почты.</p>
    </div>
    <div class="panel" id="login"></div>
  </section>
  ${projectsSection()}`;
  flow = loginFlow($('#login'), { onDone: () => { history.replaceState(null, '', '/me'); boot(); } });
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
  <div class="grid2">
    <div>
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
        <p>Аккаунт и все входы будут удалены. Данные внутри Полки и Сквозь останутся в самих проектах.</p>
        <button class="btn danger" data-delete>Удалить аккаунт</button>
      </section>
    </div>
  </div>
  ${projectsSection()}`;

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
  if (c.bot) $('#bot-link').innerHTML = `Бот: <a href="https://t.me/${esc(c.bot)}">@${esc(c.bot)}</a>`;
}).catch(() => {}).finally(boot);
