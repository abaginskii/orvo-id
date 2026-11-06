import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, readJSON, writeJSON, remove, mutate } from './store.js';
import { config } from './config.js';

const LOGIN_TTL = 5 * 60_000;
const SESSION_TTL = 30 * 86400_000;
const CODE_TTL = 2 * 60_000;
const MAX_SESSIONS = 10;

export const token = (bytes = 18) => randomBytes(bytes).toString('base64url');
const hash = s => createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();
const iso = () => new Date().toISOString();
export const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------- signed cookie ----------
function sign(data) {
  if ((config.secret || '').length < 32) throw new AppError('orvo ID ещё не настроен.', 503);
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return body + '.' + createHmac('sha256', config.secret).update(body).digest('base64url');
}
function unsign(value) {
  if (!value || (config.secret || '').length < 32) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', config.secret).update(body).digest('base64url');
  if (!safeEq(sig, expected)) return null;
  try { const data = JSON.parse(Buffer.from(body, 'base64url').toString()); return data.exp > now() ? data : null; }
  catch { return null; }
}

// ---------- users ----------
const userPath = id => `users/${id}.json`;
const tgPath = tgId => `telegram/${Number(tgId)}.json`;
const namePath = name => `names/${name.toLowerCase()}.json`;
const sessionsPath = uid => `sessions/${uid}.json`;
const grantsPath = uid => `grants/${uid}.json`;
// E-mail addresses never appear in file names: only their hash does.
const emailKey = e => hash('email:' + e).slice(0, 40);
const emailPath = e => `emails/${emailKey(e)}.json`;
const emailCodePath = e => `emailcodes/${emailKey(e)}.json`;
const proofPath = t => `emailproofs/${t}.json`;

export const getUser = async id => (/^[A-Za-z0-9_-]{8,40}$/.test(id || '') ? (await readJSON(userPath(id)))?.value : null) || null;
export async function userByTelegram(tgId) {
  const link = await readJSON(tgPath(tgId));
  return link ? getUser(link.value.uid) : null;
}

export function cleanName(name) {
  const value = String(name || '').replace(/\s+/g, ' ').trim();
  if (value.length < 1 || value.length > 48) throw new AppError('Имя: от 1 до 48 символов.');
  return value;
}
export function cleanUsername(name) {
  const value = String(name || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(value)) throw new AppError('Ник: 3–24 символа, латиница, цифры и _.');
  if (/^(admin|orvo|support|root|system|id|api)$/.test(value)) throw new AppError('Этот ник занят.');
  return value;
}

export async function userByEmail(email) {
  const link = await readJSON(emailPath(email));
  return link ? getUser(link.value.uid) : null;
}

export function cleanEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) throw new AppError('Проверьте адрес почты.');
  return e;
}

// ---------- e-mail codes ----------
const EMAIL_CODE_TTL = 10 * 60_000, RESEND_AFTER = 60_000, MAX_TRIES = 5, MAX_SENDS_PER_HOUR = 6;

// A fresh 6-digit code for this address. Limits keep our mailbox from being used for spam.
export async function issueEmailCode(email, purpose) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await mutate(emailCodePath(email), r => {
    const t = now();
    if (r.sentAt && t - r.sentAt < RESEND_AFTER) throw new AppError(`Письмо уже отправлено. Новое можно запросить через ${Math.ceil((RESEND_AFTER - (t - r.sentAt)) / 1000)} с.`, 429);
    const sends = (r.sends || []).filter(x => t - x < 3600_000);
    if (sends.length >= MAX_SENDS_PER_HOUR) throw new AppError('Слишком много писем на этот адрес. Попробуйте через час.', 429);
    Object.assign(r, { codeHash: hash(email + ':' + code), purpose, expiresAt: t + EMAIL_CODE_TTL, tries: 0, sentAt: t, sends: [...sends, t] });
  }, {});
  return code;
}

// Wrong codes count against the address; a right one is spent at once.
export async function checkEmailCode(email, code, purpose) {
  const clean = String(code || '').replace(/\D/g, '');
  let ok = false;
  await mutate(emailCodePath(email), r => {
    if (!r.codeHash || r.purpose !== purpose || r.expiresAt < now()) throw new AppError('Код устарел. Запросите новый.', 410);
    if (r.tries >= MAX_TRIES) throw new AppError('Слишком много попыток. Запросите новый код.', 429);
    r.tries += 1;
    if (clean.length === 6 && safeEq(hash(email + ':' + clean), r.codeHash)) { ok = true; r.codeHash = null; }
  }, {});
  if (!ok) throw new AppError('Код не подошёл. Проверьте письмо.', 400);
}

// Someone sending too many codes from one network.
export async function limitByIp(ip) {
  const key = hash('ip:' + ip).slice(0, 32);
  await mutate(`iplimits/${key}.json`, r => {
    const t = now();
    r.sends = (r.sends || []).filter(x => t - x < 3600_000);
    if (r.sends.length >= 20) throw new AppError('Слишком много запросов. Попробуйте через час.', 429);
    r.sends.push(t);
  }, {});
}

// A new person proved their address but has no orvo ID yet: this lets them finish sign-up.
export async function createEmailProof(email) {
  const t = token(24);
  await writeJSON(proofPath(t), { email, expiresAt: now() + 15 * 60_000 }, { createOnly: true });
  return t;
}
export async function takeEmailProof(t) {
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(t || '')) throw new AppError('Подтверждение устарело. Запросите код ещё раз.', 410);
  const r = await readJSON(proofPath(t));
  if (!r || r.value.expiresAt < now()) throw new AppError('Подтверждение устарело. Запросите код ещё раз.', 410);
  await remove(proofPath(t));
  return r.value.email;
}

export async function suggestFromEmail(email) {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
  for (const candidate of [base, base + '_orvo', base + randomInt(100, 999)]) {
    try { cleanUsername(candidate); } catch { continue; }
    if (!(await readJSON(namePath(candidate)))) return candidate;
  }
  return '';
}

export async function suggestUsername(tg) {
  const base = (tg.username || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'user' + String(tg.id).slice(-6);
  for (const candidate of [base, base + '_orvo', base + String(tg.id).slice(-3)]) {
    try { cleanUsername(candidate); } catch { continue; }
    if (!(await readJSON(namePath(candidate)))) return candidate;
  }
  return '';
}

// An orvo ID needs at least one way in: Telegram, a confirmed e-mail, or both.
export async function createUser(tg, name, username, { email = null } = {}) {
  name = cleanName(name);
  username = cleanUsername(username);
  if (!tg && !email) throw new AppError('Нужен Telegram или почта.', 400);
  if (tg && await userByTelegram(tg.id)) throw new AppError('У этого Telegram уже есть orvo ID.', 409);
  if (email && await userByEmail(email)) throw new AppError('Эта почта уже привязана к orvo ID. Войдите по ней.', 409);
  const id = token(12);
  try { await writeJSON(namePath(username), { uid: id }, { createOnly: true }); }
  catch (e) { if (e.status === 409) throw new AppError('Ник уже занят, выберите другой.', 409); throw e; }
  const user = {
    id, name, username,
    telegram: tg ? { id: Number(tg.id), username: tg.username || null, firstName: tg.first_name || '', lastName: tg.last_name || '' } : null,
    email: email ? { address: email, verifiedAt: iso() } : null,
    createdAt: iso(), updatedAt: iso()
  };
  await writeJSON(userPath(id), user, { createOnly: true });
  if (tg) await writeJSON(tgPath(tg.id), { uid: id }, { createOnly: true });
  if (email) await writeJSON(emailPath(email), { uid: id }, { createOnly: true });
  return user;
}

// Adds or changes the confirmed e-mail of an existing orvo ID.
export async function attachEmail(user, email) {
  const owner = await userByEmail(email);
  if (owner && owner.id !== user.id) throw new AppError('Эта почта уже привязана к другому orvo ID.', 409);
  if (!owner) {
    try { await writeJSON(emailPath(email), { uid: user.id }, { createOnly: true }); }
    catch (e) { if (e.status === 409) throw new AppError('Эта почта уже привязана к другому orvo ID.', 409); throw e; }
  }
  const old = user.email?.address;
  if (old && old !== email) await remove(emailPath(old));
  return mutate(userPath(user.id), u => { u.email = { address: email, verifiedAt: iso() }; u.updatedAt = iso(); return u; });
}

// Links Telegram to an orvo ID made with e-mail. Two accounts are never merged silently.
export async function attachTelegram(user, tg) {
  const owner = await userByTelegram(tg.id);
  if (owner && owner.id !== user.id) throw new AppError('Этот Telegram уже привязан к другому orvo ID. Войдите через Telegram и добавьте почту там.', 409);
  if (!owner) {
    try { await writeJSON(tgPath(tg.id), { uid: user.id }, { createOnly: true }); }
    catch (e) { if (e.status === 409) throw new AppError('Этот Telegram уже привязан к другому orvo ID.', 409); throw e; }
  }
  return mutate(userPath(user.id), u => {
    u.telegram = { id: Number(tg.id), username: tg.username || null, firstName: tg.first_name || '', lastName: tg.last_name || '' };
    u.updatedAt = iso(); return u;
  });
}

export async function updateUser(user, input) {
  const name = input.name !== undefined ? cleanName(input.name) : user.name;
  const username = input.username !== undefined ? cleanUsername(input.username) : user.username;
  if (username !== user.username) {
    try { await writeJSON(namePath(username), { uid: user.id }, { createOnly: true }); }
    catch (e) { if (e.status === 409) throw new AppError('Ник уже занят, выберите другой.', 409); throw e; }
    await remove(namePath(user.username));
  }
  return mutate(userPath(user.id), u => { u.name = name; u.username = username; u.updatedAt = iso(); return u; });
}

export async function deleteUser(user) {
  await Promise.all([
    remove(userPath(user.id)), user.telegram ? remove(tgPath(user.telegram.id)) : null, user.email ? remove(emailPath(user.email.address)) : null, remove(namePath(user.username)),
    remove(sessionsPath(user.id)), remove(grantsPath(user.id))
  ]);
}

// Telegram data that may be refreshed on each sign-in (their @username can change).
export async function touchTelegram(user, tg) {
  if (!user.telegram || (tg.username || null) === user.telegram.username) return user;
  return mutate(userPath(user.id), u => { u.telegram.username = tg.username || null; return u; });
}

export const publicProfile = (user, base) => ({
  sub: user.id,
  name: user.name,
  username: user.username,
  telegram_id: user.telegram?.id ?? null,
  telegram_username: user.telegram?.username ?? null,
  avatar: `${base}/api/avatar/${user.id}`,
  created_at: user.createdAt
});

// ---------- sessions ----------
export const deviceName = ua => {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
  const br = /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'браузер';
  return `${br}, ${os}`;
};

export async function startSession(user, req) {
  const sid = token(12);
  await mutate(sessionsPath(user.id), list => {
    list.unshift({ sid, device: deviceName(req.headers['user-agent']), createdAt: iso(), lastAt: iso() });
    list.splice(MAX_SESSIONS);
  }, []);
  return sign({ uid: user.id, sid, exp: now() + SESSION_TTL });
}

export async function sessionUser(cookie) {
  const data = unsign(cookie);
  if (!data) return null;
  const sessions = (await readJSON(sessionsPath(data.uid)))?.value || [];
  const current = sessions.find(s => s.sid === data.sid);
  if (!current) return null;
  const user = await getUser(data.uid);
  if (!user) return null;
  // Refresh "last seen" at most once an hour to keep storage writes low.
  if (now() - Date.parse(current.lastAt) > 3600_000) {
    mutate(sessionsPath(user.id), list => { const s = list.find(x => x.sid === data.sid); if (s) s.lastAt = iso(); }, []).catch(() => {});
  }
  return { user, sid: data.sid };
}

export const listSessions = async uid => (await readJSON(sessionsPath(uid)))?.value || [];
export const endSessions = (uid, keep) => mutate(sessionsPath(uid), list => {
  const left = list.filter(s => (typeof keep === 'function' ? keep(s) : false));
  list.splice(0, list.length, ...left);
}, []);

// ---------- Telegram login requests ----------
const loginPath = code => {
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(code || '')) throw new AppError('Ссылка входа устарела.', 404);
  return `logins/${code}.json`;
};

// linkTo: the same bot confirmation, used to link Telegram to an existing orvo ID instead of signing in.
export async function startLogin(device, approvedBy, { linkTo = null } = {}) {
  const code = token(12), poll = token(24);
  const record = { pollHash: hash(poll), status: 'pending', device, createdAt: now(), expiresAt: now() + LOGIN_TTL, ...(linkTo ? { linkTo } : {}) };
  // Mini App sign-in: Telegram already vouched for the person, no confirmation message needed.
  if (approvedBy) Object.assign(record, { status: 'approved', decidedAt: now(), telegram: { id: approvedBy.id, username: approvedBy.username || null, first_name: approvedBy.first_name || '', last_name: approvedBy.last_name || '' } });
  await writeJSON(loginPath(code), record, { createOnly: true });
  return { code, poll, expiresAt: now() + LOGIN_TTL };
}

export async function readLogin(code, poll) {
  const record = await readJSON(loginPath(code));
  if (!record) throw new AppError('Ссылка входа устарела. Начните заново.', 404);
  if (poll !== undefined && !safeEq(hash(poll), record.value.pollHash)) throw new AppError('Ссылка входа устарела. Начните заново.', 404);
  const value = record.value;
  if (value.status === 'pending' && value.expiresAt < now()) value.status = 'expired';
  return value;
}

// Called by the bot when the person taps «Войти» or «Это не я».
export async function decideLogin(code, approve, tg) {
  return mutate(loginPath(code), login => {
    if (login.status !== 'pending' || login.expiresAt < now()) return { ok: false, status: login.expiresAt < now() ? 'expired' : login.status };
    login.status = approve ? 'approved' : 'denied';
    login.telegram = approve ? { id: tg.id, username: tg.username || null, first_name: tg.first_name || '', last_name: tg.last_name || '' } : null;
    login.decidedAt = now();
    return { ok: true, status: login.status, device: login.device };
  }, null).catch(e => { if (e.status === 404 || e instanceof TypeError) return { ok: false, status: 'expired' }; throw e; });
}

export const finishLogin = code => remove(loginPath(code));

// ---------- OAuth-style codes for projects ----------
export async function listGrants(uid) { return (await readJSON(grantsPath(uid)))?.value || {}; }
export const revokeGrant = (uid, clientId) => mutate(grantsPath(uid), g => { delete g[clientId]; }, {});

export async function issueCode(user, client, redirectUri) {
  const code = token(24);
  await writeJSON(`codes/${code}.json`, { uid: user.id, client: client.id, redirectUri, expiresAt: now() + CODE_TTL }, { createOnly: true });
  const first = await mutate(grantsPath(user.id), g => {
    const isNew = !g[client.id];
    g[client.id] = { firstAt: g[client.id]?.firstAt || iso(), lastAt: iso(), count: (g[client.id]?.count || 0) + 1 };
    return isNew;
  }, {});
  return { code, first };
}

export async function redeemCode(code, client, redirectUri) {
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(code || '')) throw new AppError('Код входа неверен.', 400);
  const path = `codes/${code}.json`;
  const record = await readJSON(path);
  if (!record) throw new AppError('Код входа неверен или уже использован.', 400);
  await remove(path);
  const value = record.value;
  if (value.expiresAt < now() || value.client !== client.id || value.redirectUri !== redirectUri) throw new AppError('Код входа неверен или устарел.', 400);
  const user = await getUser(value.uid);
  if (!user) throw new AppError('Аккаунт orvo ID удалён.', 400);
  return user;
}
