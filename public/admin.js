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

const link = code => `${location.origin}/me?promo=${encodeURIComponent(code)}`;
const randomCode = () => 'ORVO-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
let fresh = null; // the code just issued, shown with its link

function render() {
  const { users, promos } = data;
  const count = p => users.filter(u => u.plan === p).length;
  app.innerHTML = `<h1>Управление orvo</h1>
  <div class="totals"><div><b>${users.length}</b><span>аккаунтов</span></div><div><b>${count('plus')}</b><span>с plus</span></div><div><b>${count('premium')}</b><span>с premium</span></div><div><b>${promos.filter(p => p.active).length}</b><span>кодов работает</span></div></div>

  <section class="card" id="promos"><h2>Выпустить промокод</h2>
    <p>Код включает orvo plus или premium во всех сервисах сразу. Один человек применяет код один раз.</p>
    <form class="promo-new" data-new novalidate>
      <div class="field"><label for="c">Код</label><div class="input"><input id="c" name="code" placeholder="DRUZYA" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="chip" type="button" data-gen>Придумать</button></div><small>Латиница, цифры, дефис</small></div>
      <div class="field"><span class="lbl">Тариф</span><div class="seg" data-seg="plan"><button type="button" class="on" data-v="plus">plus</button><button type="button" data-v="premium">premium</button></div></div>
      <div class="field"><span class="lbl">Срок</span><div class="seg" data-seg="days"><button type="button" data-v="7">7 дн.</button><button type="button" class="on" data-v="30">30 дн.</button><button type="button" data-v="90">90 дн.</button><button type="button" data-v="365">год</button><button type="button" data-v="0">навсегда</button></div></div>
      <div class="field"><label for="m">Сколько человек</label><div class="input"><input id="m" name="maxUses" type="number" min="1" value="10" inputmode="numeric"></div></div>
      <div class="field"><label for="n">Заметка для себя</label><div class="input"><input id="n" name="note" placeholder="Например: для группы в Telegram" maxlength="120"></div></div>
      <button class="btn" type="submit">Выпустить код</button>
      <div class="note err" role="alert" hidden></div>
    </form>
    ${fresh ? `<div class="issued"><div><b>${esc(fresh.code)}</b><small>${esc(PLANS[fresh.plan].short)}, ${fresh.days ? `${fresh.days} дн.` : 'навсегда'}, на ${fresh.maxUses} чел.</small></div><code>${esc(link(fresh.code))}</code><div class="acts"><button class="chip" data-copy="${esc(link(fresh.code))}">Скопировать ссылку</button><button class="chip" data-copy="${esc(fresh.code)}">Скопировать код</button></div></div>` : ''}
  </section>

  <section class="card"><h2>Промокоды</h2>
    <div class="ulist">${promos.map(p => `<div class="prow ${p.active ? '' : 'off'}"><div><b>${esc(p.code)}</b><small>${esc(PLANS[p.plan].short)}, ${p.days ? `${p.days} дн.` : 'навсегда'}${p.note ? `. ${esc(p.note)}` : ''}</small></div><span>${p.uses} из ${p.maxUses}</span><div class="acts"><button class="chip" data-copy="${esc(link(p.code))}">Ссылка</button><button class="chip" data-toggle="${esc(p.code)}" data-on="${p.active ? 0 : 1}">${p.active ? 'Выключить' : 'Включить'}</button></div></div>`).join('') || '<p>Кодов пока нет.</p>'}</div>
  </section>

  <section class="card" id="users"><h2>Люди и тарифы</h2><p>Тариф включается сразу во всех сервисах.</p>
    <div class="input search"><input placeholder="Найти по имени или нику" data-q autocomplete="off"></div>
    <div class="ulist" data-ulist>${users.map(userRow).join('')}</div>
  </section>
  <p class="foot-note">Промокоды Сквозь на дни VPN живут отдельно, в <a href="https://skvoz-app.vercel.app/admin" target="_blank" rel="noopener">пункте управления Сквозь</a>.</p>`;
}

function userRow(u) {
  return `<div class="urow" data-name="${esc((u.name + ' ' + u.username + ' ' + (u.telegram || '')).toLowerCase())}">${avatar({ name: u.name, avatar: `/api/avatar/${u.id}` })}<div><b>${esc(u.name)}</b><small>@${esc(u.username)}, с ${date(u.createdAt)}</small></div>
      <div><span class="tag ${u.plan === 'free' ? 'off' : 'plan ' + u.plan}">${esc(planText(u))}</span><small>${u.apps.length ? esc(u.apps.join(', ')) : 'Сервисы ещё не открывал'}</small></div>
      <div class="acts"><button class="chip" data-id="${u.id}" data-plan="plus" data-days="30">plus +30</button><button class="chip" data-id="${u.id}" data-plan="premium" data-days="30">premium +30</button><button class="chip" data-id="${u.id}" data-plan="premium" data-days="0">premium навсегда</button>${u.plan !== 'free' ? `<button class="chip danger" data-cancel="${u.id}">Отключить</button>` : ''}</div></div>`;
}

app.addEventListener('input', e => {
  if (!e.target.matches('[data-q]')) return;
  const q = e.target.value.trim().toLowerCase();
  app.querySelectorAll('[data-ulist] .urow').forEach(r => { r.hidden = !!q && !r.dataset.name.includes(q); });
});

app.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.gen !== undefined) { app.querySelector('#c').value = randomCode(); return; }
  if (b.closest('[data-seg]')) { b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); return; }
  if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано'); } catch { toast(b.dataset.copy); } return; }
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
  const seg = k => f.querySelector(`[data-seg="${k}"] .on`).dataset.v;
  try {
    const { promo } = await api('/api/admin/promos', { method: 'POST', body: { code: f.code.value, plan: seg('plan'), days: Number(seg('days')), maxUses: Number(f.maxUses.value), note: f.note.value } });
    fresh = promo; toast('Код выпущен'); load();
  }
  catch (x) { err.hidden = false; err.textContent = x.message; }
});
$('#refresh').onclick = load;
load();
