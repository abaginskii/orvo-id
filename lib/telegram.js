// Telegram bot for orvo ID. Works through a webhook: Telegram POSTs updates to /api/telegram.
import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { projects } from './projects.js';
import * as A from './accounts.js';

export async function tg(method, payload) {
  if (!config.botToken) throw new Error('BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data.result;
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const https = base => base.startsWith('https://');
const day = iso => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
const clock = ms => new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' МСК';
const projectName = id => projects.find(p => p.id === id)?.name || id;
const projectIn = id => projects.find(p => p.id === id)?.inName || projectName(id);

// Buttons that open the site: inside Telegram as a Mini App when possible.
const openSite = (base, text = 'Открыть orvo ID', path = '/') =>
  https(base) ? { text, web_app: { url: base + path } } : null;
const rows = (...r) => r.map(row => row.filter(Boolean)).filter(row => row.length);

async function send(chatId, text, keyboard = []) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: keyboard } });
}
async function edit(cb, text, keyboard = []) {
  return tg('editMessageText', {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id, text, parse_mode: 'HTML',
    link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: keyboard }
  }).catch(e => { if (!/not modified/.test(e.message)) throw e; });
}

// ---------- screens ----------
async function homeScreen(from, base) {
  const user = await A.userByTelegram(from.id);
  if (!user) {
    return {
      text: `<b>Привет, ${esc(from.first_name || 'друг')}!</b>\n\nЭто <b>orvo ID</b> — один аккаунт для всех проектов orvo: Сквозь, Kite, Полки и тех, что появятся дальше.\n\nПароль не нужен. На сайте нажмите «Войти через Telegram», а здесь подтвердите вход одной кнопкой. Аккаунт создастся при первом входе.`,
      keyboard: rows([openSite(base, 'Создать orvo ID')], [{ text: 'Проекты orvo', callback_data: 'projects' }], [{ text: 'Как это работает', callback_data: 'help' }])
    };
  }
  const grants = await A.listGrants(user.id);
  const used = Object.keys(grants);
  const tgName = user.telegram.username ? ` · Telegram @${esc(user.telegram.username)}` : '';
  return {
    text: `<b>${esc(user.name)}</b>\n@${esc(user.username)}${tgName}\nС нами с ${day(user.createdAt)}\n\n${used.length ? `Вход выполнен в ${used.map(projectIn).map(esc).join(', ')}.` : 'Вы ещё не входили в проекты. Попробуйте Сквозь или Kite: там кнопка «Войти с orvo ID».'}`,
    keyboard: rows([openSite(base, 'Профиль', '/me')], [{ text: 'Проекты', callback_data: 'projects' }, { text: 'Где я вошёл', callback_data: 'sessions' }])
  };
}

function projectsScreen() {
  const list = projects.map(p => `<b>${esc(p.name)}</b>${p.status === 'soon' ? ' · скоро' : ''}\n${esc(p.about)}${p.orvoLogin ? '\n<i>Вход через orvo ID</i>' : ''}`).join('\n\n');
  return {
    text: `<b>Проекты orvo</b>\n\n${list}`,
    keyboard: rows(...projects.filter(p => p.url).map(p => [{ text: p.name, url: p.url }]), [{ text: '‹ Назад', callback_data: 'home' }])
  };
}

async function sessionsScreen(from) {
  const user = await A.userByTelegram(from.id);
  if (!user) return { text: 'У вас ещё нет orvo ID.', keyboard: rows([{ text: '‹ Назад', callback_data: 'home' }]) };
  const sessions = await A.listSessions(user.id);
  const text = sessions.length
    ? `<b>Где вы вошли</b>\n\n${sessions.map(s => `• ${esc(s.device)}, с ${day(s.createdAt)}`).join('\n')}\n\nЕсли устройство незнакомое, завершите все сеансы. Войти снова можно в любой момент.`
    : '<b>Где вы вошли</b>\n\nСейчас нет открытых сеансов.';
  return { text, keyboard: rows(sessions.length ? [{ text: 'Завершить все сеансы', callback_data: 'logout?' }] : [], [{ text: '‹ Назад', callback_data: 'home' }]) };
}

const helpText = '<b>Как войти</b>\n\n1. На сайте orvo ID или в проекте нажмите «Войти через Telegram» или «Войти с orvo ID».\n2. Здесь появится сообщение с кнопкой «Войти».\n3. Нажмите её, и сайт откроется сам.\n\nЕсли пришло сообщение о входе, который вы не начинали, нажмите «Это не я»: никто не получит доступ.\n\n/start — главное меню\n/me — мой orvo ID\n/logout — выйти на всех устройствах';

// ---------- updates ----------
export async function handleUpdate(update, base) {
  const msg = update.message;
  const cb = update.callback_query;

  if (msg?.text && msg.chat?.type === 'private') {
    const [cmd, arg = ''] = msg.text.trim().split(/\s+/, 2);
    if (cmd === '/start' && arg.startsWith('login_')) return loginRequest(msg, arg.slice(6), base);
    if (cmd === '/start' || cmd === '/me') { const s = await homeScreen(msg.from, base); return send(msg.chat.id, s.text, s.keyboard); }
    if (cmd === '/help') return send(msg.chat.id, helpText, rows([{ text: '‹ В меню', callback_data: 'home' }]));
    if (cmd === '/logout') { const s = await sessionsScreen(msg.from); return send(msg.chat.id, s.text, s.keyboard); }
    return send(msg.chat.id, 'Я подтверждаю вход в orvo ID. Начните вход на сайте, и здесь появится кнопка «Войти».', rows([openSite(base)], [{ text: 'Меню', callback_data: 'home' }]));
  }

  if (!cb?.data) return;
  const answer = text => tg('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});

  if (/^(ok|no):/.test(cb.data)) {
    const approve = cb.data.startsWith('ok:');
    const code = cb.data.slice(3);
    const result = await A.decideLogin(code, approve, cb.from);
    await answer(result.ok ? (approve ? 'Вход подтверждён' : 'Вход отклонён') : 'Ссылка устарела');
    if (!cb.message) return;
    if (!result.ok) return edit(cb, '<b>Ссылка устарела</b>\nНачните вход на сайте заново, и здесь появится новая кнопка.');
    if (!approve) return edit(cb, '<b>Вход отклонён</b>\nНикто не получил доступ к вашему orvo ID. Если такое повторяется, просто игнорируйте эти сообщения.');
    return edit(cb, `<b>Вход подтверждён</b>\n${esc(result.device || 'Браузер')}\n\nВернитесь на сайт: он уже открывается.`);
  }

  if (cb.data === 'home' || cb.data === 'projects' || cb.data === 'sessions' || cb.data === 'help') {
    await answer();
    const s = cb.data === 'home' ? await homeScreen(cb.from, base)
      : cb.data === 'projects' ? projectsScreen()
      : cb.data === 'sessions' ? await sessionsScreen(cb.from)
      : { text: helpText, keyboard: rows([{ text: '‹ Назад', callback_data: 'home' }]) };
    return edit(cb, s.text, s.keyboard);
  }

  if (cb.data === 'logout?') {
    await answer();
    return edit(cb, '<b>Завершить все сеансы?</b>\nВы выйдете из orvo ID на всех устройствах. Проекты, в которые вы уже вошли, останутся открытыми до их собственного выхода.',
      rows([{ text: 'Да, завершить', callback_data: 'logout!' }], [{ text: 'Отмена', callback_data: 'sessions' }]));
  }
  if (cb.data === 'logout!') {
    const user = await A.userByTelegram(cb.from.id);
    if (user) await A.endSessions(user.id, () => false);
    await answer('Готово');
    return edit(cb, '<b>Все сеансы завершены</b>\nЧтобы войти снова, нажмите на сайте «Войти через Telegram».', rows([{ text: '‹ В меню', callback_data: 'home' }]));
  }
  return answer();
}

async function loginRequest(msg, code, base) {
  let login;
  try { login = await A.readLogin(code); } catch { login = null; }
  if (!login || login.status !== 'pending') {
    return send(msg.chat.id, '<b>Ссылка устарела</b>\nНачните вход на сайте заново, и здесь появится новая кнопка.', rows([openSite(base)]));
  }
  const user = await A.userByTelegram(msg.from.id);
  if (login.linkTo) {
    const target = await A.getUser(login.linkTo);
    if (user) return send(msg.chat.id, `<b>Этот Telegram уже привязан</b>\n\nОн связан с orvo ID @${esc(user.username)}. Войдите через Telegram и добавьте почту в профиле.`, rows([openSite(base)]));
    return send(msg.chat.id,
      `<b>Привязать Telegram к orvo ID</b>\n\nАккаунт <b>${esc(target?.name || '')}</b> (@${esc(target?.username || '')}) хочет входить через этот Telegram.\n\n<b>Устройство:</b> ${esc(login.device || 'браузер')}\n\nНажмите «Привязать», только если делаете это сами.`,
      [[{ text: 'Привязать', callback_data: 'ok:' + code }], [{ text: 'Это не я', callback_data: 'no:' + code }]]);
  }
  const who = user ? `как <b>${esc(user.name)}</b> (@${esc(user.username)})` : 'и создать новый orvo ID';
  return send(msg.chat.id,
    `<b>Вход в orvo ID</b>\n\nКто-то хочет войти ${who}.\n\n<b>Устройство:</b> ${esc(login.device || 'браузер')}\n<b>Время:</b> ${clock(login.createdAt)}\n\nНажмите «Войти», только если входите сами. Если ссылку прислал другой человек, ничего не нажимайте: так крадут аккаунты.`,
    [[{ text: 'Войти', callback_data: 'ok:' + code }], [{ text: 'Это не я', callback_data: 'no:' + code }]]);
}

// ---------- notifications (never block the request that triggered them) ----------
export function notify(chatId, text, keyboard = []) {
  if (!config.botToken) return Promise.resolve();
  return send(chatId, text, keyboard).catch(e => console.error('notify', e.message));
}
export const notifyWelcome = (user, base) => !user.telegram ? Promise.resolve() : notify(user.telegram.id,
  `<b>orvo ID создан</b>\n\n${esc(user.name)}, ваш ник — @${esc(user.username)}.\nТеперь им можно войти в Сквозь, Kite, Полку и другие проекты orvo: ищите кнопку «Войти с orvo ID».`,
  rows([openSite(base, 'Мой профиль', '/me')], [{ text: 'Проекты orvo', callback_data: 'projects' }]));
export const notifyProject = (user, clientId, base) => !user.telegram ? Promise.resolve() : notify(user.telegram.id,
  `<b>Проект «${esc(projectName(clientId))}» подключён к orvo ID</b>\n\nВы вошли в ${esc(projectIn(clientId))} со своим orvo ID. Отключить проект можно в профиле.`,
  rows([openSite(base, 'Управлять', '/me')]));

// ---------- Mini App sign-in ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyWebAppData(initData, maxAgeSec = 3600) {
  if (!initData || !config.botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = createHmac('sha256', secret).update(check).digest('hex');
  if (!A.safeEq(calc, hash)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

// Streams a person's Telegram profile photo without exposing the bot token.
export async function profilePhoto(tgId) {
  if (!config.botToken) return null;
  const photos = await tg('getUserProfilePhotos', { user_id: tgId, limit: 1 }).catch(() => null);
  const sizes = photos?.photos?.[0];
  if (!sizes?.length) return null;
  const pick = sizes.find(s => s.width >= 320) || sizes[sizes.length - 1];
  const file = await tg('getFile', { file_id: pick.file_id }).catch(() => null);
  if (!file?.file_path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}
