// Letters from orvo: people subscribe on the orvo site with a 6-digit code (the same code as sign-in by e-mail).
import { createHmac, createHash } from 'node:crypto';
import { readJSON, writeJSON, remove } from './store.js';
import { config } from './config.js';
import { safeEq, userByEmail } from './accounts.js';

const key = e => createHash('sha256').update('news:' + e).digest('hex').slice(0, 40);
const path = e => `news/${key(e)}.json`;

// Sites allowed to call /api/news/* from the browser. NEWS_ORIGINS adds more, comma-separated.
const DEFAULT_ORIGINS = ['https://orvo-home.vercel.app', 'https://orvo-home.pages.dev'];
export function newsOrigin(origin) {
  if (!origin) return null;
  const extra = (process.env.NEWS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if ([...DEFAULT_ORIGINS, ...extra].includes(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.orvo-home\.pages\.dev$/.test(origin)) return origin; // Cloudflare previews
  if (!config.isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export const unsubscribeToken = email => createHmac('sha256', config.secret).update('unsub:' + email).digest('base64url').slice(0, 32);

export async function subscribe(email, source) {
  const existing = await readJSON(path(email));
  if (existing) return { already: true };
  const user = await userByEmail(email).catch(() => null);
  await writeJSON(path(email), { email, source: String(source || 'site').slice(0, 40), uid: user?.id || null, at: new Date().toISOString() });
  return { already: false, hasOrvoId: !!user };
}

export async function unsubscribe(email, token) {
  if (!safeEq(String(token || ''), unsubscribeToken(email))) return false;
  await remove(path(email));
  return true;
}
