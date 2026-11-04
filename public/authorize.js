// "Полка wants to sign you in with orvo ID": sign in if needed, then send the person back with a one-time code.
import { $, esc, api, mark, avatar, loginFlow, telegramInitData } from './ui.js';

const box = $('#box');
const params = new URLSearchParams(location.search);
const request = { client_id: params.get('client_id'), redirect_uri: params.get('redirect_uri'), state: params.get('state') || '' };
const query = new URLSearchParams({ client_id: request.client_id || '', redirect_uri: request.redirect_uri || '' });

const bridge = p => `<div class="bridge" aria-hidden="true"><span class="glyph" style="background:${esc(p.color || '#2F3033')}">${esc(p.glyph || p.name[0])}</span><span class="wire"></span>${mark('intro')}</div>`;

async function go() {
  const btn = box.querySelector('[data-allow]'); if (btn) btn.disabled = true;
  try {
    const r = await api('/api/authorize', { method: 'POST', body: request });
    location.replace(r.redirect);
  } catch (e) { show(e.message); }
}

function show(error) {
  box.innerHTML = `<div class="flow center"><h1>Не получилось войти</h1><div class="note err" role="alert">${esc(error)}</div><a class="btn plain" href="/">На главную orvo ID</a></div>`;
}

async function render() {
  let info;
  try { info = await api('/api/authorize?' + query); } catch (e) { return show(e.message); }
  const { project, user, granted } = info;

  if (user && granted) {
    box.innerHTML = `${bridge(project)}<h1>Входим в ${esc(project.inName || project.name)}…</h1><p class="sub">как ${esc(user.name)}</p>`;
    return setTimeout(go, 500);
  }

  if (!user) {
    box.innerHTML = `${bridge(project)}<div id="login"></div>`;
    loginFlow($('#login'), { title: `Вход в ${project.inName || project.name}`, sub: `${project.name} использует orvo ID. Пароль не нужен: вход подтверждается в Telegram.`, after: `Если orvo ID ещё нет, создадим его, и вы вернётесь в ${project.inName || project.name}`, onDone: render });
    return;
  }

  box.innerHTML = `${bridge(project)}
    <h1>${esc(project.name)} просит войти через orvo ID</h1>
    <p class="sub">${esc(project.name)} получит:</p>
    <ul class="shares"><li>имя и ник</li><li>аккаунт Telegram и фото профиля</li><li>постоянный номер orvo ID, чтобы узнавать вас</li></ul>
    <div class="who">${avatar(user)}<div><b>${esc(user.name)}</b><br><small style="color:var(--muted)">@${esc(user.username)}</small></div></div>
    <div class="flow">
      <button class="btn big wide" data-allow>${mark()}<span>Продолжить как ${esc(user.name.split(' ')[0])}</span></button>
      <div class="row" style="justify-content:space-between"><button class="link" data-switch>Другой аккаунт</button><a class="link" href="${esc(request.redirect_uri ? new URL(request.redirect_uri).origin : '/')}">Отмена</a></div>
    </div>`;
  box.querySelector('[data-allow]').onclick = go;
  box.querySelector('[data-switch]').onclick = async () => { await api('/api/logout', { method: 'POST' }); render(); };
}

api('/api/config').then(c => { window.__orvoDev = c.devLogin; }).catch(() => {}).finally(render);
