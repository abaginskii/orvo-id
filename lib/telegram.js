// Telegram bot for orvo ID. Works through a webhook: Telegram POSTs updates to /api/telegram.
import { config } from './config.js';
import { decideLogin, userByTelegram } from './accounts.js';

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
const siteButton = (base, text = 'Открыть orvo ID') => (base.startsWith('https://') ? [[{ text, url: base }]] : []);

export async function handleUpdate(update, base) {
  const msg = update.message;
  const cb = update.callback_query;

  if (msg?.text && msg.chat?.type === 'private') {
    const [cmd, arg = ''] = msg.text.trim().split(/\s+/, 2);
    if (cmd === '/start' && arg.startsWith('login_')) {
      const code = arg.slice(6);
      return tg('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: '<b>Вход в orvo ID</b>\n\nНа сайте ждут подтверждения. Нажмите «Войти», если входите вы.\n\nЕсли вы ничего не открывали, нажмите «Это не я»: никто не получит доступ.',
        reply_markup: { inline_keyboard: [[{ text: 'Войти', callback_data: 'ok:' + code }], [{ text: 'Это не я', callback_data: 'no:' + code }]] }
      });
    }
    if (cmd === '/start' || cmd === '/me') {
      const user = await userByTelegram(msg.from.id);
      const text = user
        ? `<b>${esc(user.name)}</b> · @${esc(user.username)}\n\nЭто ваш orvo ID. Им можно войти в Полку, Сквозь и другие проекты orvo: нажмите на сайте «Войти с orvo ID».`
        : '<b>orvo ID</b> — один аккаунт для всех проектов orvo.\n\nНажмите на сайте «Войти через Telegram», и бот пришлёт кнопку подтверждения. Аккаунт создаётся при первом входе.';
      return tg('sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text, reply_markup: { inline_keyboard: siteButton(base) } });
    }
    return tg('sendMessage', { chat_id: msg.chat.id, text: 'Я подтверждаю вход в orvo ID. Начните вход на сайте, и здесь появится кнопка.', reply_markup: { inline_keyboard: siteButton(base) } });
  }

  if (cb?.data && /^(ok|no):/.test(cb.data)) {
    const approve = cb.data.startsWith('ok:');
    const result = await decideLogin(cb.data.slice(3), approve, cb.from);
    const text = result.ok
      ? (approve ? '<b>Вход подтверждён.</b>\nВернитесь на сайт, он откроется сам.' : '<b>Вход отклонён.</b>\nНикто не получил доступ к вашему orvo ID.')
      : '<b>Ссылка устарела.</b>\nНачните вход на сайте заново.';
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: result.ok ? (approve ? 'Готово' : 'Отклонено') : 'Ссылка устарела' }).catch(() => {});
    if (cb.message) {
      await tg('editMessageText', {
        chat_id: cb.message.chat.id, message_id: cb.message.message_id, parse_mode: 'HTML', text,
        reply_markup: { inline_keyboard: approve && result.ok ? siteButton(base, 'Вернуться на сайт') : [] }
      }).catch(() => {});
    }
  }
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
