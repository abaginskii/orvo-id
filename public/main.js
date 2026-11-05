import { $, esc, api, mark, plusMark, avatar, toast, loginFlow, telegramInitData, mountShaderR, reveal } from './ui.js';
import { projects } from './projects.js';
import { PLANS, LIMITS } from './plans.js';

const hero = $('#hero');
const app = $('#app');
const nav = $('#nav');
let flow = null;

const date = v => new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const ago = iso => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 2) return 'сейчас';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return date(iso);
};
const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// What plus gives inside each service, in one line.
const plusIn = {
  skvoz: `Без ограничения по времени, до ${LIMITS.skvoz.plus.devices} устройств`,
  polka: `${LIMITS.polka.plus.aiPerDay} запросов к ИИ в день вместо ${LIMITS.polka.free.aiPerDay}`,
  norma: `${LIMITS.norma.plus.aiPerDay} оценок блюд в день вместо ${LIMITS.norma.free.aiPerDay}`
};
const order = ['skvoz', 'polka', 'norma'];
const services = order.map(id => projects.find(p => p.id === id)).filter(Boolean);

function tiles() {
  return `<div class="tiles">${services.map((p, i) => `<a class="tile rise" style="--glow:${esc(p.glow)};transition-delay:${i * 80}ms" href="${esc(p.url)}" target="_blank" rel="noopener">
      <span class="go" aria-hidden="true">${arrow}</span>
      <span class="glyph" aria-hidden="true">${esc(p.glyph)}</span>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.tagline)}</p>
    </a>`).join('')}</div>`;
}

function priceCard(id, current) {
  const plan = PLANS[id], gold = id === 'premium';
  const active = current === id;
  return `<article class="price ${id} rise">
    <div class="head">${plusMark(gold ? 'premium' : '')}<span>orvo <span class="grad ${gold ? 'gold' : ''}">${plan.short}</span></span></div>
    <div class="amount">${plan.price} ₽</div>
    <div class="per">в месяц за все сервисы</div>
    <ul>${plan.perks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${active ? '<div class="current">Ваш тариф</div>' : `<button class="btn ${gold ? 'gold' : ''} wide" data-buy="${id}">Подключить ${plan.short}</button><p class="soon">Оплата картой скоро. Сейчас тариф включается промокодом.</p>`}
  </article>`;
}

function plusSection(me) {
  const current = me?.subscription?.plan || 'free';
  return `<section class="section" id="plus" aria-labelledby="plus-title">
    <div class="plus-head rise">${plusMark('intro')}<span class="wordplus" id="plus-title">orvo <b>plus</b></span></div>
    <p class="title-sub rise">Одна подписка открывает больше во всех сервисах сразу. Оформили один раз в orvo ID, и Сквозь, Полка и Норма узнают об этом сами.</p>
    <div class="prices">${priceCard('plus', current)}${priceCard('premium', current)}</div>
    <div class="promo-line rise">
      <p><b>Есть промокод?</b> ${me ? 'Введите его, и тариф включится сразу во всех сервисах.' : 'Войдите в orvo ID и введите его в профиле.'}</p>
      ${me ? promoForm() : '<a class="btn" href="#login">Войти и ввести код</a>'}
    </div>
  </section>`;
}

const promoForm = () => `<form class="promo-form" data-promo novalidate><label class="sr" for="promo-code">Промокод</label><div class="input"><input id="promo-code" name="code" placeholder="ПРОМОКОД" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32"></div><button class="btn" type="submit">Активировать</button><div class="note err" role="alert" hidden></div></form>`;


function faq() {
  const qa = [
    ['Что такое orvo ID?', 'Один аккаунт для всех сервисов orvo. Вход подтверждается в Telegram, пароль не нужен. Если аккаунта нет, он создаётся при первом входе.'],
    ['Что даёт orvo plus?', `Сквозь работает без ограничения по времени, Полка даёт ${LIMITS.polka.plus.aiPerDay} запросов к ИИ в день, Норма оценивает до ${LIMITS.norma.plus.aiPerDay} блюд по фото. Premium добавляет ещё больше и ранний доступ к новым сервисам.`],
    ['Как оплатить?', 'Оплата картой появится скоро. Сейчас тарифы включаются промокодом: введите его в профиле orvo ID.'],
    ['Что видят сервисы обо мне?', 'Имя, ник, аккаунт Telegram и тариф. Каждый сервис хранит свои данные у себя, orvo ID их не читает.'],
    ['Можно пользоваться бесплатно?', 'Да. У каждого сервиса есть бесплатный уровень: пробные дни в Сквозь, ИИ-запросы в Полке и Норме с дневным лимитом.']
  ];
  return `<section class="section" aria-labelledby="faq-title"><h2 class="title rise" id="faq-title">Вопросы</h2><div class="faq">${qa.map(([q, a]) => `<details class="rise"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>`;
}

function bindPromo(root, after) {
  root.querySelectorAll('[data-promo]').forEach(form => form.onsubmit = async e => {
    e.preventDefault();
    const err = form.querySelector('.note'), btn = form.querySelector('button');
    err.hidden = true; btn.disabled = true;
    try {
      const r = await api('/api/me/promo', { method: 'POST', body: { code: form.code.value } });
      toast(`${PLANS[r.subscription.plan].name} включена`); after();
    } catch (x) { err.hidden = false; err.textContent = x.message; btn.disabled = false; }
  });
  root.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
    const me = document.body.dataset.me === '1';
    if (!me) { location.hash = '#login'; $('#login')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const input = $('#promo-code') || $('[data-promo] input');
    input?.focus(); input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Оплата скоро. Пока тариф включается промокодом');
  });
}

function renderLanding() {
  document.body.dataset.me = '0';
  nav.innerHTML = '<a class="navlink" href="#services">Сервисы</a><a class="navlink" href="#plus">orvo plus</a><a class="btn ghost" href="#login">Войти</a>';
  hero.innerHTML = `<section class="hero">
    <div>
      <h1>Три сервиса.<br>Один <em>orvo</em>.</h1>
      <p class="lede">VPN, учёба и питание под одним аккаунтом. Вход через Telegram, одна подписка открывает больше везде.</p>
      <div class="cta"><a class="btn big" href="#login">${mark()}<span>Войти с orvo ID</span></a></div>
    </div>
    <div class="panel" id="login"></div>
  </section>`;
  app.innerHTML = `<section class="section" id="services" aria-labelledby="svc-title">
      <h2 class="title rise" id="svc-title">Каждый делает одно дело хорошо</h2>
      <p class="title-sub rise">Один аккаунт подходит ко всем. Войдите в любом из них кнопкой «Войти с orvo ID».</p>
      ${tiles()}
    </section>
    ${plusSection(null)}
    ${faq()}`;
  const initData = telegramInitData();
  const start = resume => { flow = loginFlow($('#login'), { resume, onDone: () => { history.replaceState(null, '', '/me'); boot(); } }); };
  if (initData) api('/api/login/webapp', { method: 'POST', body: { initData } }).then(start, () => start());
  else start();
  bindPromo(app);
  reveal();
}

function subCard(sub) {
  const plan = sub.plan;
  if (plan === 'free') {
    return `<section class="sub-card off" aria-labelledby="sub-title">
      <div class="row-top"><div><h2 id="sub-title">Все сервисы orvo в одной подписке</h2><p>Подключите orvo plus: Сквозь без срока, больше ИИ в Полке и Норме.${sub.expired ? ` Прошлая подписка закончилась ${date(sub.expired)}.` : ''}</p></div><a class="btn" href="#plus">Тарифы</a></div>
      ${promoForm()}
    </section>`;
  }
  const gold = plan === 'premium';
  return `<section class="sub-card on ${gold ? 'premium' : ''}" aria-labelledby="sub-title">
    <div class="row-top"><div><h2 id="sub-title">${esc(PLANS[plan].name)} активна</h2><p>${sub.until ? `До ${date(sub.until)}.` : 'Без срока окончания.'} Преимущества уже работают во всех сервисах.</p></div>${plusMark(`ghost ${gold ? 'premium' : ''}`)}</div>
    <div class="perks">${services.map(p => `<div><b>${esc(p.name)}</b><br>${esc(plan === 'premium' && p.id === 'skvoz' ? `До ${LIMITS.skvoz.premium.devices} устройств, без срока` : plan === 'premium' && p.id === 'polka' ? `${LIMITS.polka.premium.aiPerDay} запросов к ИИ в день` : plan === 'premium' && p.id === 'norma' ? `${LIMITS.norma.premium.aiPerDay} оценок в день` : plusIn[p.id])}</div>`).join('')}</div>
  </section>`;
}

function renderProfile(data) {
  document.body.dataset.me = '1';
  const { user, apps, sessions, subscription, owner } = data;
  nav.innerHTML = `<a class="navlink" href="#plus">orvo plus</a>${owner ? '<a class="navlink" href="/admin">Управление</a>' : ''}<button class="btn ghost" data-logout>Выйти</button>`;
  const used = Object.fromEntries(apps.map(a => [a.id, a]));
  const plan = subscription.plan;
  hero.innerHTML = `<section class="me-hero">
    <span class="avatar-wrap">${avatar(user)}${plan !== 'free' ? plusMark(`badge ${plan === 'premium' ? 'premium' : ''}`) : ''}</span>
    <div><h1>${esc(user.name)}</h1>
      <div class="ids"><span class="tag ${plan === 'free' ? 'off' : `plan ${plan}`}">${plan === 'free' ? 'plus не подключена' : `${PLANS[plan].short} активна`}</span><span class="tag">@${esc(user.username)}</span>${user.telegram ? `<span class="tag">Telegram @${esc(user.telegram)}</span>` : ''}<span class="tag soon">С нами с ${date(user.createdAt)}</span></div>
    </div>
  </section>`;
  const rows = services.map(p => {
    const g = used[p.id];
    const action = g ? `<div class="state">Вход ${ago(g.lastAt)}<br><button class="link" data-revoke="${esc(p.id)}">Отключить</button></div>` : `<a class="open" href="${esc(p.url)}" target="_blank" rel="noopener">Открыть</a>`;
    return `<li class="project"><span class="glyph" style="background:${esc(p.color)}" aria-hidden="true">${esc(p.glyph)}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.tagline)}</p></div>${action}</li>`;
  }).join('');

  app.innerHTML = `${owner ? `<a class="owner-card" href="/admin"><b>Управление orvo</b><span>Промокоды и тарифы людей</span></a>` : ''}${subCard(subscription)}
  <div class="grid2">
    <div>
      <section class="card" aria-labelledby="p-apps"><h2 id="p-apps">Сервисы</h2><p>Куда вы входили с orvo ID. Отключите сервис, и при следующем входе он снова спросит разрешение.</p><ul class="projects">${rows}</ul></section>
      <section class="card" aria-labelledby="p-sess"><h2 id="p-sess">Где вы вошли</h2><p>Завершите сеанс, если не узнаёте устройство.</p>
        ${sessions.map(s => `<div class="sess"><div><b>${esc(s.device)}</b><small>Вход ${date(s.createdAt)}, активность ${ago(s.lastAt)}</small></div>${s.current ? '<span class="here">Это устройство</span>' : `<button class="btn plain" data-end="${esc(s.id)}">Завершить</button>`}</div>`).join('')}
        ${sessions.length > 1 ? '<div class="row" style="margin-top:12px"><button class="link" data-end-all>Завершить все, кроме этого</button></div>' : ''}
      </section>
    </div>
    <div>
      <section class="card" aria-labelledby="p-prof"><h2 id="p-prof">Профиль</h2><p>Имя и ник видят сервисы, в которые вы входите.</p>
        <form class="form" data-profile novalidate>
          <div class="field"><label for="p-name">Имя</label><div class="input"><input id="p-name" name="name" maxlength="48" value="${esc(user.name)}"></div></div>
          <div class="field"><label for="p-user">Ник</label><div class="input"><span>@</span><input id="p-user" name="username" maxlength="24" value="${esc(user.username)}" autocapitalize="off" spellcheck="false"></div></div>
          <div class="note err" role="alert" hidden></div>
          <div class="row"><button class="btn" type="submit">Сохранить</button></div>
        </form>
      </section>
      <section class="card" aria-labelledby="p-del"><h2 id="p-del">Удалить orvo ID</h2><p>Аккаунт, входы и подписка будут удалены. Данные внутри сервисов останутся в самих сервисах.</p><button class="btn danger" data-delete>Удалить аккаунт</button></section>
    </div>
  </div>`;

  // Ссылка вида /me?promo=CODE: код подставлен, остаётся нажать «Активировать».
  const code = new URLSearchParams(location.search).get('promo');
  const input = $('#promo-code');
  if (code && input) {
    input.value = code.toUpperCase().slice(0, 32);
    input.closest('.sub-card')?.scrollIntoView({ block: 'center' });
    history.replaceState(null, '', location.pathname + location.hash);
  }

  $('[data-logout]').onclick = async () => { await api('/api/logout', { method: 'POST' }); history.replaceState(null, '', '/'); boot(); };
  const form = $('[data-profile]');
  form.onsubmit = async e => {
    e.preventDefault();
    const err = form.querySelector('.note'); err.hidden = true;
    try { await api('/api/me', { method: 'PATCH', body: { name: form.name.value, username: form.username.value } }); toast('Профиль сохранён'); boot(); }
    catch (x) { err.hidden = false; err.textContent = x.message; }
  };
  app.querySelectorAll('[data-end]').forEach(b => b.onclick = async () => { await api('/api/sessions/end', { method: 'POST', body: { id: b.dataset.end } }); toast('Сеанс завершён'); boot(); });
  $('[data-end-all]')?.addEventListener('click', async () => { await api('/api/sessions/end', { method: 'POST', body: { all: true } }); toast('Другие сеансы завершены'); boot(); });
  app.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => { await api('/api/apps/revoke', { method: 'POST', body: { id: b.dataset.revoke } }); toast('Сервис отключён'); boot(); });
  $('[data-delete]').onclick = async () => {
    const answer = prompt(`Чтобы удалить orvo ID, введите свой ник: ${user.username}`);
    if (answer == null) return;
    try { await api('/api/me', { method: 'DELETE', body: { confirm: answer } }); history.replaceState(null, '', '/'); boot(); toast('orvo ID удалён'); }
    catch (x) { toast(x.message); }
  };
  bindPromo(app, boot);
  reveal();
}

async function boot() {
  flow?.destroy(); flow = null;
  try {
    const data = await api('/api/me');
    if (location.pathname === '/') history.replaceState(null, '', '/me' + location.hash);
    renderProfile(data);
  } catch {
    if (location.pathname === '/me') history.replaceState(null, '', '/' + location.hash);
    renderLanding();
  }
  if (location.hash.length > 1) $(location.hash)?.scrollIntoView();
}

mountShaderR($('#fx-hero'));
api('/api/config').then(c => {
  window.__orvoDev = c.devLogin;
  if (c.bot) $('#bot-link').innerHTML = `Бот: <a href="https://t.me/${esc(c.bot)}">@${esc(c.bot)}</a>`;
}).catch(() => {}).finally(boot);
