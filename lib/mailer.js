// Sign-in codes by e-mail. SMTP settings come from the environment (see README, «Вход по почте»).
import { AppError } from './store.js';

const env = process.env;
export const mailReady = () => !!(env.SMTP_USER && env.SMTP_PASSWORD) || !env.VERCEL;

const texts = {
  login: { subject: code => `${code} — код входа в orvo ID`, lead: 'Ваш код для входа в orvo ID:' },
  attach: { subject: code => `${code} — подтверждение почты orvo ID`, lead: 'Код, чтобы привязать эту почту к orvo ID:' }
};

export async function sendCode(email, code, purpose = 'login') {
  const t = texts[purpose] || texts.login;
  const text = `${t.lead}\n\n${code}\n\nКод действует 10 минут. Никому его не сообщайте: сотрудники orvo никогда его не спрашивают.\nЕсли вы ничего не запрашивали, просто удалите это письмо.`;
  const html = `<div style="font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1A1322;max-width:420px">
    <p>${t.lead}</p>
    <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</p>
    <p style="color:#6b6475">Код действует 10 минут. Никому его не сообщайте: сотрудники orvo никогда его не спрашивают.<br>Если вы ничего не запрашивали, просто удалите это письмо.</p></div>`;

  // Local development without a mailbox: show the code in the server log.
  if (!(env.SMTP_USER && env.SMTP_PASSWORD)) {
    if (env.VERCEL) throw new AppError('Вход по почте ещё не настроен. Войдите через Telegram.', 503);
    console.log(`[mail to ${email}] ${t.subject(code)}`);
    return;
  }
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.yandex.ru', port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000
  });
  try {
    await transport.sendMail({ from: { name: env.MAIL_FROM_NAME || 'orvo ID', address: env.SMTP_USER }, to: email, subject: t.subject(code), text, html });
  } catch (e) {
    console.error('mail', e.code || e.name, e.responseCode || '');
    throw new AppError('Не получилось отправить письмо. Попробуйте ещё раз или войдите через Telegram.', 502);
  }
}
