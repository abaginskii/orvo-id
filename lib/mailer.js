// Sign-in codes by e-mail. SMTP settings come from the environment (see README, «Вход по почте»).
import { AppError } from './store.js';

const env = process.env;
export const mailReady = () => !!(env.SMTP_USER && env.SMTP_PASSWORD) || !env.VERCEL;

const texts = {
  login: { subject: code => `${code} — код входа в orvo ID`, lead: 'Ваш код для входа в orvo ID:' },
  attach: { subject: code => `${code} — подтверждение почты orvo ID`, lead: 'Код, чтобы привязать эту почту к orvo ID:' },
  news: { subject: code => `${code} — подтверждение почты orvo ID`, lead: 'Код, чтобы получать письма orvo:' }
};

export async function sendCode(email, code, purpose = 'login') {
  const t = texts[purpose] || texts.login;
  const text = `${t.lead}\n\n${code}\n\nКод действует 10 минут. Никому его не сообщайте: сотрудники orvo никогда его не спрашивают.\nЕсли вы ничего не запрашивали, просто удалите это письмо.`;
  const html = `<div style="font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1A1322;max-width:420px">
    <p>${t.lead}</p>
    <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
    <p style="color:#6b6475">Код действует 10 минут. Никому его не сообщайте: сотрудники orvo никогда его не спрашивают.<br>Если вы ничего не запрашивали, просто удалите это письмо.</p></div>`;

  await deliver(email, t.subject(code), text, html);
}

async function deliver(to, subject, text, html) {
  // Local development without a mailbox: show the letter in the server log.
  if (!(env.SMTP_USER && env.SMTP_PASSWORD)) {
    if (env.VERCEL) throw new AppError('Почта ещё не настроена. Войдите через Telegram.', 503);
    console.log(`[mail to ${to}] ${subject}`);
    return;
  }
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.yandex.ru', port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000
  });
  try {
    // MAIL_FROM: services like Brevo log in with one name and send from a verified address.
    await transport.sendMail({ from: { name: env.MAIL_FROM_NAME || 'orvo ID', address: env.MAIL_FROM || env.SMTP_USER }, to, subject, text, html });
  } catch (e) {
    console.error('mail', e.code || e.name, e.responseCode || '');
    throw new AppError('Не получилось отправить письмо. Попробуйте ещё раз или войдите через Telegram.', 502);
  }
}

// After the code is right: the letter that says the address is confirmed and what will come to it.
export async function sendNewsConfirmed(email, unsubscribeUrl) {
  const subject = 'orvo ID: почта подтверждена';
  const text = `Почта ${email} подтверждена.\n\nСюда будут приходить письма orvo: новые проекты и большие обновления Полки, Kite, Bite, Mise и Сквозь. Не чаще пары раз в месяц, без рекламы чужих сервисов.\n\nЕсли передумаете, отписаться можно по ссылке:\n${unsubscribeUrl}`;
  const html = `<div style="font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1A1322;max-width:460px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:40px;height:40px;border-radius:20px;background:#B6405A;background:radial-gradient(circle at 50% 0%,#F0603A 0%,#B6405A 45%,#4F3A6B 100%);text-align:center;vertical-align:middle;color:#fff;font-weight:700">o</td>
      <td style="padding-left:12px;font-weight:600">orvo ID</td></tr></table>
    <h1 style="font-size:24px;line-height:1.25;margin:22px 0 8px">Почта подтверждена</h1>
    <p style="margin:0 0 14px"><b>${email}</b> теперь в списке рассылки orvo.</p>
    <p style="margin:0 0 14px">Сюда будут приходить новые проекты и большие обновления Полки, Kite, Bite, Mise и Сквозь. Не чаще пары раз в месяц, без рекламы чужих сервисов.</p>
    <p style="color:#6b6475;font-size:13px;margin:26px 0 0">Это письмо пришло, потому что адрес подтвердили кодом на сайте orvo. <a href="${unsubscribeUrl}" style="color:#6b6475">Отписаться</a></p></div>`;
  await deliver(email, subject, text, html);
}
