const env = process.env;

export const config = {
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  secret: env.ORVO_SECRET || (!env.VERCEL ? 'dev-only-secret-dev-only-secret-0000' : ''),
  botToken: env.BOT_TOKEN || '',
  botUsername: (env.BOT_USERNAME || '').replace(/^@/, ''),
  webhookSecret: env.TG_WEBHOOK_SECRET || '',
  // Lets the local dev server confirm a login without Telegram. Never enabled on Vercel.
  // Owner pages (/admin): Telegram ids, comma separated, or a bearer token for scripts.
  adminIds: String(env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => Number(x.trim())).filter(Boolean),
  adminToken: env.ADMIN_TOKEN || '',
  devLogin: !env.VERCEL && env.ORVO_DEV_LOGIN === '1',
  isProd: !!env.VERCEL || env.NODE_ENV === 'production'
};

// Projects that may sign people in with orvo ID.
// ORVO_CLIENTS = [{"id":"polka","secret":"…","redirects":["https://…/api/auth/orvo/callback"],"webhook":"https://…/api/orvo/webhook"}]
// webhook is optional: orvo ID POSTs plan changes there, signed with the client secret.
// Names, colors and links live in public/projects.js so the site and the server agree.
export function clients() {
  try {
    const list = JSON.parse(env.ORVO_CLIENTS || '[]');
    return Array.isArray(list) ? list.filter(c => c && c.id && c.secret && Array.isArray(c.redirects)) : [];
  } catch { return []; }
}
export const findClient = id => clients().find(c => c.id === id) || null;

export const publicBase = req => {
  if (config.publicUrl) return config.publicUrl;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
};
