// Owner page: who is on which plan, switch plans by hand, issue promo codes.
import { $, esc, api, avatar, toast } from './ui.js';
import { PLANS } from './plans.js';

const app = $('#app');
const date = v => new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const planText = u => u.plan === 'free' ? 'Бесплатно' : `${PLANS[u.plan].short}, ${u.until ? 'до ' + date(u.until) : 'без срока'}`;
let data = null;

async function load() {
  try { data = await api('/api/admin/overview'); render(); }
  catch (e) { app.innerHTML = `<div class="card"><h2>${e.status === 403 ? 'Только для владельца' : 'Не загрузилось'}</h2><p>${esc(e.message)}</p><a class="btn" href="/">Войти в orvo ID</a></div>`; }
}

function render() {
  const { users, promos } = data;
  const count = p => users.filter(u => u.plan === p).length;
  app.innerHTML = `<h1>Подписки orvo</h1>
  <div class="totals"><div><b>${users.length}</b><span>аккаунтов orvo ID</span></div><div><b>${count('plus')}</b><span>с plus</span></div><div><b>${count('premium')}</b><span>с premium</span></div><div><b>${promos.filter(p => p.active).length}</b><span>промокодов работает</span></div></div>
  <section class="card"><h2>Люди</h2><p>Тариф действует сразу во всех сервисах: orvo ID сам сообщит Сквозь, Полке и Норме.</p>
    <div class="ulist">${users.map(u => `<div class="urow">${avatar({ name: u.name, avatar: `/api/avatar/${u.id}` })}<div><b>${esc(u.name)}</b><small>@${esc(u.username)}${u.telegram ? ` · Telegram @${esc(u.telegram)}` : ''} · с ${date(u.createdAt)}</small></div>
      <div><span class="tag ${u.plan === 'free' ? 'off' : 'plan ' + u.plan}">${esc(planText(u))}</span><small>${u.apps.length ? 'Входил в: ' + esc(u.apps.join(', ')) : 'Сервисы ещё не открывал'}</small></div>
      <div class="acts"><button class="chip plus" data-id="${u.id}" data-plan="plus" data-days="30">plus +30 дн.</button><button class="chip premium" data-id="${u.id}" data-plan="premium" data-days="30">premium +30</button><button class="chip" data-id="${u.id}" data-plan="premium" data-days="0">premium навсегда</button>${u.plan !== 'free' ? `<button class="chip danger" data-cancel="${u.id}">Отключить</button>` : ''}</div></div>`).join('')}</div>
  </section>
  <section class="card"><h2>Промокоды</h2><p>Код включает тариф на нужное число дней (0 — навсегда). Один человек активирует код один раз.</p>
    <div class="ulist">${promos.map(p => `<div class="prow ${p.active ? '' : 'off'}"><div><b>${esc(p.code)}</b><small>${esc(PLANS[p.plan].short)}, ${p.days ? `${p.days} дн.` : 'навсегда'}${p.note ? ' · ' + esc(p.note) : ''}</small></div><span>${p.uses} из ${p.maxUses}</span><button class="chip" data-toggle="${esc(p.code)}" data-on="${p.active ? 0 : 1}">${p.active ? 'Выключить' : 'Включить'}</button></div>`).join('') || '<p>Промокодов пока нет.</p>'}</div>
    <form class="pgrid" data-new style="margin-top:16px" novalidate>
      <div class="field"><label for="c">Код</label><div class="input"><input id="c" name="code" placeholder="ДРУЗЬЯ" maxlength="32" autocomplete="off"></div></div>
      <div class="field"><label for="pl">Тариф</label><div class="input"><select id="pl" name="plan"><option value="plus">plus</option><option value="premium">premium</option></select></div></div>
      <div class="field"><label for="d">Дней</label><div class="input"><input id="d" name="days" type="number" min="0" value="30"></div></div>
      <div class="field"><label for="m">Активаций</label><div class="input"><input id="m" name="maxUses" type="number" min="1" value="50"></div></div>
      <button class="btn" type="submit">Выпустить</button>
      <div class="note err" role="alert" hidden style="grid-column:1/-1"></div>
    </form>
  </section>`;
}

app.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.plan) { await api('/api/admin/user', { method: 'POST', body: { id: b.dataset.id, action: 'grant', plan: b.dataset.plan, days: Number(b.dataset.days) } }); toast('Тариф включён'); }
    else if (b.dataset.cancel) { if (!confirm('Отключить подписку?')) return; await api('/api/admin/user', { method: 'POST', body: { id: b.dataset.cancel, action: 'cancel' } }); toast('Подписка отключена'); }
    else if (b.dataset.toggle) await api('/api/admin/promos', { method: 'POST', body: { code: b.dataset.toggle, action: b.dataset.on === '1' ? 'enable' : 'disable' } });
    else return;
    load();
  } catch (x) { toast(x.message); }
});
app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = f.querySelector('.note'); err.hidden = true;
  try { await api('/api/admin/promos', { method: 'POST', body: { code: f.code.value, plan: f.plan.value, days: Number(f.days.value), maxUses: Number(f.maxUses.value) } }); toast('Промокод выпущен'); load(); }
  catch (x) { err.hidden = false; err.textContent = x.message; }
});
$('#refresh').onclick = load;
load();
