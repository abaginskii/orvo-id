import { AppError, storageReady } from './store.js';
import { config, findClient, publicBase } from './config.js';
import { projects } from './projects.js';
import * as A from './accounts.js';
import { handleUpdate, profilePhoto, verifyWebAppData, notifyWelcome, notifyProject, notifyPlan } from './telegram.js';
import * as S from './subs.js';
import { PLANS } from '../public/plans.js';

const COOKIE = 'orvo_session';

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (Buffer.isBuffer(body)) return res.end(body);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 64_000) throw new AppError('Слишком большой запрос.', 413); chunks.push(c); }
  const text = Buffer.concat(chunks).toString();
  if (!text) return {};
  if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try { return JSON.parse(text); } catch { throw new AppError('Некорректный запрос.'); }
}

const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setCookie = (res, value, maxAge) => res.setHeader('set-cookie',
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.isProd ? '; Secure' : ''}`);

// Browser-facing writes must come from this site.
function sameOrigin(req, base) {
  const origin = req.headers.origin;
  if (origin && origin !== base && !(origin.startsWith('http://localhost') && !config.isProd)) throw new AppError('Запрос с другого сайта отклонён.', 403);
}

const projectName = id => projects.find(p => p.id === id)?.name || id;

function validateAuthorize(q) {
  const client = findClient(q.client_id);
  if (!client) throw new AppError('Этот проект не подключён к orvo ID.', 400);
  if (!client.redirects.includes(q.redirect_uri)) throw new AppError('Адрес возврата не разрешён для этого проекта.', 400);
  return client;
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const forced = url.searchParams.get('__p');
  const path = forced !== null ? '/api/' + forced.replace(/^\/+/, '') : url.pathname;
  url.searchParams.delete('__p');
  const q = Object.fromEntries(url.searchParams);
  const base = publicBase(req);
  const method = req.method;

  try {
    // ----- Telegram webhook -----
    if (path === '/api/telegram' && method === 'POST') {
      if (!config.webhookSecret || !A.safeEq(req.headers['x-telegram-bot-api-secret-token'] || '', config.webhookSecret)) return send(res, 403, { ok: false });
      const update = await readBody(req);
      await handleUpdate(update, base).catch(e => console.error('bot', e.message));
      return send(res, 200, { ok: true });
    }

    if (path === '/api/config') {
      return send(res, 200, { bot: config.botUsername || null, botReady: !!(config.botToken && config.botUsername), storage: storageReady(), devLogin: config.devLogin });
    }

    // ----- token exchange (server to server, from Полка / Сквозь) -----
    if (path === '/api/oauth/token' && method === 'POST') {
      const body = await readBody(req);
      const client = findClient(body.client_id);
      if (!client || !A.safeEq(body.client_secret || '', client.secret)) throw new AppError('Неверный client_secret.', 401);
      const user = await A.redeemCode(body.code, client, body.redirect_uri);
      return send(res, 200, { user: A.publicProfile(user, base) });
    }

    // Services ask for the current plan (server to server). Body: client_id, client_secret, sub or telegram_id.
    if (path === '/api/oauth/plan' && method === 'POST') {
      const body = await readBody(req);
      const client = findClient(body.client_id);
      if (!client || !A.safeEq(body.client_secret || '', client.secret)) throw new AppError('Неверный client_secret.', 401);
      const user = body.sub ? await A.getUser(String(body.sub)) : body.telegram_id ? await A.userByTelegram(Number(body.telegram_id)) : null;
      if (!user) return send(res, 200, { plan: 'free', until: null, known: false });
      const p = S.planOf(user);
      return send(res, 200, { plan: p.plan, until: p.until, sub: user.id, known: true });
    }

    if (path === '/api/plans') return send(res, 200, { plans: PLANS });

    // ----- avatar -----
    const avatar = path.match(/^\/api\/avatar\/([A-Za-z0-9_-]+)$/);
    if (avatar) {
      const user = await A.getUser(avatar[1]);
      const photo = user && await profilePhoto(user.telegram.id);
      if (!photo) return send(res, 404, { error: 'Нет фото' });
      return send(res, 200, photo, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600, s-maxage=86400' });
    }

    const session = await A.sessionUser(cookies(req)[COOKIE]).catch(() => null);
    const me = session?.user || null;

    // ----- Telegram login -----
    if (path === '/api/login/start' && method === 'POST') {
      sameOrigin(req, base);
      if (!config.botUsername && !config.devLogin) throw new AppError('Бот orvo ID ещё не подключён. Попробуйте позже.', 503);
      const login = await A.startLogin(A.deviceName(req.headers['user-agent']));
      return send(res, 200, { ...login, bot: config.botUsername, link: config.botUsername ? `https://t.me/${config.botUsername}?start=login_${login.code}` : null });
    }

    // Opened inside Telegram (bot menu button): Telegram's signed data replaces the confirmation step.
    if (path === '/api/login/webapp' && method === 'POST') {
      sameOrigin(req, base);
      const tgUser = verifyWebAppData((await readBody(req)).initData);
      if (!tgUser) throw new AppError('Не удалось проверить данные Telegram. Войдите кнопкой.', 401);
      const login = await A.startLogin('Telegram', tgUser);
      return send(res, 200, login);
    }

    if (path === '/api/login/poll' && method === 'POST') {
      sameOrigin(req, base);
      const { code, poll } = await readBody(req);
      const login = await A.readLogin(code, poll);
      if (login.status !== 'approved') return send(res, 200, { status: login.status });
      const user = await A.userByTelegram(login.telegram.id);
      if (user) {
        await A.touchTelegram(user, login.telegram);
        setCookie(res, await A.startSession(user, req), 30 * 86400);
        await A.finishLogin(code);
        return send(res, 200, { status: 'done', user: { name: user.name, username: user.username } });
      }
      return send(res, 200, {
        status: 'new',
        suggest: { name: [login.telegram.first_name, login.telegram.last_name].filter(Boolean).join(' ') || 'Без имени', username: await A.suggestUsername(login.telegram), telegram: login.telegram.username }
      });
    }

    if (path === '/api/login/create' && method === 'POST') {
      sameOrigin(req, base);
      const body = await readBody(req);
      const login = await A.readLogin(body.code, body.poll);
      if (login.status !== 'approved' || Date.now() - login.decidedAt > 15 * 60_000) throw new AppError('Подтверждение устарело. Войдите через Telegram ещё раз.', 410);
      const user = await A.createUser(login.telegram, body.name, body.username);
      await notifyWelcome(user, base);
      setCookie(res, await A.startSession(user, req), 30 * 86400);
      await A.finishLogin(body.code);
      return send(res, 201, { status: 'done', user: { name: user.name, username: user.username } });
    }

    if (path === '/api/login/dev-approve' && method === 'POST' && config.devLogin) {
      const body = await readBody(req);
      return send(res, 200, await A.decideLogin(body.code, true, { id: Number(body.tgId || 100001), username: body.tgUsername || 'artem_dev', first_name: body.firstName || 'Артём', last_name: '' }));
    }

    if (path === '/api/logout' && method === 'POST') {
      sameOrigin(req, base);
      if (me) await A.endSessions(me.id, s => s.sid !== session.sid);
      setCookie(res, '', 0);
      return send(res, 200, { ok: true });
    }

    // ----- consent for projects -----
    if (path === '/api/authorize') {
      const client = validateAuthorize(method === 'POST' ? await readBody(req).then(b => Object.assign(q, b)) : q);
      const project = projects.find(p => p.id === client.id) || { id: client.id, name: client.id };
      if (method === 'GET') {
        const grants = me ? await A.listGrants(me.id) : {};
        return send(res, 200, { project, user: me && { name: me.name, username: me.username, avatar: `/api/avatar/${me.id}` }, granted: !!grants[client.id] });
      }
      sameOrigin(req, base);
      if (!me) throw new AppError('Сначала войдите в orvo ID.', 401);
      const { code, first } = await A.issueCode(me, client, q.redirect_uri);
      if (first) await notifyProject(me, client.id, base);
      const target = new URL(q.redirect_uri);
      target.searchParams.set('code', code);
      if (q.state) target.searchParams.set('state', String(q.state).slice(0, 200));
      return send(res, 200, { redirect: target.toString() });
    }

    // ----- owner: subscriptions and promo codes -----
    if (path.startsWith('/api/admin/')) {
      const byToken = config.adminToken && A.safeEq(req.headers.authorization || '', 'Bearer ' + config.adminToken);
      if (!byToken && !(me && config.adminIds.includes(me.telegram.id))) return send(res, 403, { error: 'Только для владельца.' });
      if (!byToken && method !== 'GET') sameOrigin(req, base);
      if (path === '/api/admin/overview') {
        const [users, promos] = await Promise.all([S.allUsers(), S.listPromos()]);
        const grants = await Promise.all(users.map(u => A.listGrants(u.id)));
        return send(res, 200, {
          users: users.map((u, i) => ({ id: u.id, name: u.name, username: u.username, telegram: u.telegram.username, telegramId: u.telegram.id, createdAt: u.createdAt, apps: Object.keys(grants[i]), ...S.planOf(u) }))
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
          promos: promos.map(p => ({ ...p, usedBy: undefined }))
        });
      }
      if (path === '/api/admin/user' && method === 'POST') {
        const b = await readBody(req);
        const user = await A.getUser(String(b.id || ''));
        if (!user) throw new AppError('Пользователь не найден.', 404);
        if (b.action === 'cancel') await S.cancel(user.id);
        else if (b.action === 'grant') { const u = await S.grant(user.id, b.plan, Number(b.days) || 0, 'owner'); await notifyPlan(u, base).catch(() => {}); }
        else throw new AppError('Неизвестное действие.');
        return send(res, 200, { ok: true });
      }
      if (path === '/api/admin/promos' && method === 'POST') {
        const b = await readBody(req);
        if (b.action === 'enable' || b.action === 'disable') { await S.setPromoActive(b.code, b.action === 'enable'); return send(res, 200, { ok: true }); }
        return send(res, 201, { promo: await S.createPromo(b) });
      }
      throw new AppError('Не найдено.', 404);
    }

    // ----- everything below needs a session -----
    if (!path.startsWith('/api/me') && !path.startsWith('/api/sessions') && !path.startsWith('/api/apps')) throw new AppError('Не найдено.', 404);
    if (!me) throw new AppError('Войдите в orvo ID.', 401);
    if (method !== 'GET') sameOrigin(req, base);

    if (path === '/api/me' && method === 'GET') {
      const [grants, sessions] = await Promise.all([A.listGrants(me.id), A.listSessions(me.id)]);
      return send(res, 200, {
        user: { id: me.id, name: me.name, username: me.username, telegram: me.telegram.username, createdAt: me.createdAt, avatar: `/api/avatar/${me.id}` },
        subscription: S.planOf(me),
        owner: config.adminIds.includes(me.telegram.id),
        apps: Object.entries(grants).map(([id, g]) => ({ id, name: projectName(id), ...g })),
        sessions: sessions.map(s => ({ id: s.sid, device: s.device, createdAt: s.createdAt, lastAt: s.lastAt, current: s.sid === session.sid }))
      });
    }
    if (path === '/api/me/promo' && method === 'POST') {
      const r = await S.redeem(me, (await readBody(req)).code);
      await notifyPlan(r.user, base).catch(() => {});
      return send(res, 200, { subscription: S.planOf(r.user), promo: r.promo });
    }
    if (path === '/api/me' && method === 'PATCH') {
      const user = await A.updateUser(me, await readBody(req));
      return send(res, 200, { user: { name: user.name, username: user.username } });
    }
    if (path === '/api/me' && method === 'DELETE') {
      const body = await readBody(req);
      if (String(body.confirm || '').replace(/^@/, '').toLowerCase() !== me.username) throw new AppError('Введите свой ник, чтобы подтвердить удаление.');
      await A.deleteUser(me);
      setCookie(res, '', 0);
      return send(res, 200, { ok: true });
    }
    if (path === '/api/sessions/end' && method === 'POST') {
      const body = await readBody(req);
      await A.endSessions(me.id, s => (body.all ? s.sid === session.sid : s.sid !== body.id));
      return send(res, 200, { ok: true });
    }
    if (path === '/api/apps/revoke' && method === 'POST') {
      const body = await readBody(req);
      await A.revokeGrant(me.id, String(body.id || ''));
      return send(res, 200, { ok: true });
    }
    throw new AppError('Не найдено.', 404);
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status === 500) console.error(e);
    return send(res, status, { error: status === 500 ? 'Что-то сломалось на сервере. Попробуйте ещё раз.' : e.message });
  }
}
