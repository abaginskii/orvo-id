// Connects the Telegram bot to orvo ID on Vercel: saves the token, registers the webhook,
// and sets the bot's name, description and commands. Run: npm run setup-bot
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A private npm cache avoids a broken global ~/.npm cache.
const env = { ...process.env, npm_config_cache: join(tmpdir(), 'orvo-npm-cache') };
const vercel = (args, opts = {}) => spawnSync('npx', ['--yes', 'vercel@50', ...args], { env, ...opts });

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log('\norvo ID: подключение бота\n');
console.log('1. Откройте @BotFather в Telegram, отправьте /newbot.');
console.log('2. Имя: orvo ID. Ник: например orvo_id_bot (должен заканчиваться на bot).');
console.log('3. Скопируйте токен, который пришлёт BotFather.\n');
const token = (await rl.question('Токен бота: ')).trim();
const site = (await rl.question('Адрес сайта orvo ID [https://orvo-id.vercel.app]: ')).trim().replace(/\/$/, '') || 'https://orvo-id.vercel.app';
rl.close();

const call = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json();
  if (!d.ok) throw new Error(`${method}: ${d.description}`);
  return d.result;
};

const me = await call('getMe');
console.log(`\nБот найден: @${me.username}`);
const secret = randomBytes(24).toString('hex');

const setEnv = (name, value) => {
  vercel(['env', 'rm', name, 'production', '--yes'], { stdio: 'ignore' });
  const r = vercel(['env', 'add', name, 'production'], { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error(`Не удалось сохранить ${name} в Vercel`);
};
setEnv('BOT_TOKEN', token);
setEnv('BOT_USERNAME', me.username);
setEnv('TG_WEBHOOK_SECRET', secret);
console.log('Токен сохранён в Vercel.');

await call('setWebhook', { url: `${site}/api/telegram`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
await call('setMyName', { name: 'orvo ID' }).catch(() => {});
await call('setMyShortDescription', { short_description: 'Вход в проекты orvo через Telegram: Полка, Сквозь и другие.' }).catch(() => {});
await call('setMyDescription', { description: 'orvo ID — один аккаунт для всех проектов orvo.\n\nНажмите на сайте «Войти через Telegram», и здесь появится кнопка «Войти». Пароль не нужен.' }).catch(() => {});
await call('setMyCommands', { commands: [{ command: 'start', description: 'Что это за бот' }, { command: 'me', description: 'Мой orvo ID' }] });
await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'orvo ID', web_app: { url: site } } }).catch(() => {});
console.log('Webhook, описание и команды настроены.');

const r = vercel(['deploy', '--prod', '--yes'], { stdio: 'inherit' });
console.log(r.status === 0 ? `\nГотово. Откройте ${site} и нажмите «Войти через Telegram».` : '\nПередеплой не удался: запустите npx vercel deploy --prod');
