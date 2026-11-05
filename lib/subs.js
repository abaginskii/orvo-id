// orvo plus / premium. The subscription lives on the orvo ID account and every service asks here.
// Payments are not connected yet: plans are switched on by promo codes or by the owner.
import { createHmac } from 'node:crypto';
import { AppError, readJSON, writeJSON, mutate, listKeys } from './store.js';
import { clients } from './config.js';
import { PLANS, RANK } from '../public/plans.js';

const DAY = 86400_000;
const now = () => Date.now();
const userPath = id => `users/${id}.json`;
const promoPath = code => `promos/${code}.json`;

// Effective plan right now. until = null means "without an end date".
export function planOf(user) {
  const s = user?.subscription;
  if (!s || !PLANS[s.plan] || s.plan === 'free') return { plan: 'free', until: null, source: null };
  if (s.until && s.until <= now()) return { plan: 'free', until: null, source: null, expired: s.until, last: s.plan };
  return { plan: s.plan, until: s.until || null, source: s.source || null, since: s.since || null };
}

// Adds days on top of what is left; a higher plan replaces a lower one, keeping the remaining time.
// days = 0 means forever.
export async function grant(uid, plan, days, source) {
  if (!PLANS[plan] || plan === 'free') throw new AppError('Нет такого тарифа.');
  const user = await mutate(userPath(uid), u => {
    const cur = planOf(u);
    const base = cur.plan !== 'free' && cur.until ? Math.max(cur.until, now()) : now();
    const forever = days === 0 || (cur.plan !== 'free' && !cur.until && RANK[cur.plan] >= RANK[plan]);
    const keepHigher = RANK[cur.plan] > RANK[plan];
    u.subscription = {
      plan: keepHigher ? cur.plan : plan,
      until: forever ? null : base + days * DAY,
      since: cur.plan !== 'free' ? (cur.since || now()) : now(),
      source
    };
    u.updatedAt = new Date().toISOString();
    return u;
  });
  await notifyServices(user).catch(e => console.error("webhooks", e.message));
  return user;
}

export async function cancel(uid) {
  const user = await mutate(userPath(uid), u => { delete u.subscription; return u; });
  await notifyServices(user).catch(e => console.error("webhooks", e.message));
  return user;
}

// ---------- webhooks: tell every service that a plan changed ----------
// POST {webhook} with x-orvo-signature = hex(HMAC-SHA256(client secret, `${timestamp}.${body}`)).
export function signFor(secret, ts, body) { return createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex'); }

export async function notifyServices(user) {
  const p = planOf(user);
  const body = JSON.stringify({ type: 'plan', sub: user.id, telegram_id: user.telegram.id, plan: p.plan, until: p.until });
  const ts = String(Math.floor(now() / 1000));
  await Promise.allSettled(clients().filter(c => c.webhook).map(c => fetch(c.webhook, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', 'x-orvo-timestamp': ts, 'x-orvo-signature': signFor(c.secret, ts, body) },
    body
  })));
}

// ---------- promo codes ----------
export const cleanCode = code => String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

export async function createPromo({ code, plan, days, maxUses, note }) {
  code = cleanCode(code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new AppError('Код: 3–32 символа, латиница и цифры.');
  if (!PLANS[plan] || plan === 'free') throw new AppError('Выберите plus или premium.');
  days = Math.round(Number(days) || 0);
  maxUses = Math.round(Number(maxUses) || 0);
  if (days < 0 || days > 3650) throw new AppError('Дни: от 0 (навсегда) до 3650.');
  if (maxUses < 1 || maxUses > 100000) throw new AppError('Активаций: от 1 до 100000.');
  const promo = { code, plan, days, maxUses, uses: 0, usedBy: {}, note: String(note || '').slice(0, 120), active: true, createdAt: now() };
  try { await writeJSON(promoPath(code), promo, { createOnly: true }); }
  catch (e) { if (e.status === 409) throw new AppError('Такой код уже есть.', 409); throw e; }
  return promo;
}

export async function listPromos() {
  const keys = await listKeys('promos/');
  return (await Promise.all(keys.map(k => readJSON(k)))).filter(Boolean).map(r => r.value).sort((a, b) => b.createdAt - a.createdAt);
}

export const setPromoActive = (code, active) => mutate(promoPath(cleanCode(code)), p => { p.active = !!active; return p; });

// One code per account, once.
export async function redeem(user, raw) {
  const code = cleanCode(raw);
  if (!code) throw new AppError('Введите промокод.');
  const found = await readJSON(promoPath(code));
  if (!found || !found.value.active) throw new AppError('Такого промокода нет или он выключен.', 404);
  const promo = await mutate(promoPath(code), p => {
    if (p.usedBy[user.id]) throw new AppError('Вы уже активировали этот код.', 409);
    if (p.uses >= p.maxUses) throw new AppError('У этого кода закончились активации.', 410);
    p.uses += 1; p.usedBy[user.id] = now();
    return p;
  });
  const updated = await grant(user.id, promo.plan, promo.days, 'promo:' + code);
  return { user: updated, promo: { code: promo.code, plan: promo.plan, days: promo.days } };
}

// ---------- owner ----------
export async function allUsers() {
  const keys = await listKeys('users/');
  return (await Promise.all(keys.map(k => readJSON(k)))).filter(Boolean).map(r => r.value);
}
