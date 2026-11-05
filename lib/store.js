// Key-value JSON storage: orvo-store on our server in production, a local folder in development.
// orvo-store replaced Vercel Blob after the free Blob quota paused every store (see server-agent/orvo-store.py).
import { request } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const env = process.env;
const remote = () => (env.STORE_URL && env.STORE_TOKEN ? { url: env.STORE_URL.replace(/\/$/, ''), token: env.STORE_TOKEN } : null);
const localDir = () => (!remote() && !env.VERCEL ? env.DATA_DIR || env.ORVO_DATA_DIR || 'data' : null);
export const storageReady = () => !!(localDir() || remote());

const valid = path => {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(path) || path.includes('..')) throw new AppError('Некорректный путь');
  return path;
};
const sha = data => createHash('sha256').update(data).digest('hex');
const ca = () => (env.STORE_CERT_B64 ? Buffer.from(env.STORE_CERT_B64, 'base64').toString() : undefined);

// One HTTPS call to orvo-store. The server's self-signed certificate is pinned.
function call(method, path, { body, headers = {} } = {}) {
  const r = remote();
  return new Promise((resolve, reject) => {
    const req = request(r.url + path, {
      method, ca: ca(), timeout: 10000,
      headers: { authorization: 'Bearer ' + r.token, ...(body ? { 'content-length': body.length } : {}), ...headers }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('orvo-store timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function readRaw(path) {
  valid(path);
  if (!storageReady()) throw new AppError('Хранилище ещё не подключено.', 503);
  const dir = localDir();
  if (dir) {
    try { const data = await readFile(join(dir, path)); return { data, etag: sha(data) }; }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  const res = await call('GET', '/o/' + path);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`orvo-store GET ${res.status}`);
  return { data: res.data, etag: res.headers.etag || sha(res.data) };
}

export async function readJSON(path) {
  const raw = await readRaw(path);
  return raw ? { value: JSON.parse(raw.data.toString()), etag: raw.etag } : null;
}

// options.etag: write only if unchanged; options.createOnly: write only if absent. Conflicts throw 409.
export async function writeJSON(path, value, options = {}) {
  valid(path);
  const bytes = Buffer.from(JSON.stringify(value));
  const dir = localDir();
  if (dir) {
    const old = await readRaw(path);
    if ((options.createOnly && old) || (options.etag && old?.etag !== options.etag)) throw new AppError('Конфликт изменений', 409);
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    const tmp = target + '.' + randomUUID();
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
    return;
  }
  const headers = options.etag ? { 'if-match': options.etag } : options.createOnly ? { 'if-none-match': '*' } : {};
  const res = await call('PUT', '/o/' + path, { body: bytes, headers });
  if (res.status === 412) throw new AppError('Конфликт изменений', 409);
  if (res.status !== 200) throw new Error(`orvo-store PUT ${res.status}`);
}

export async function remove(path) {
  valid(path);
  const dir = localDir();
  if (dir) { await unlink(join(dir, path)).catch(e => { if (e.code !== 'ENOENT') throw e; }); return; }
  await call('DELETE', '/o/' + path).catch(() => {});
}

// Read-modify-write with optimistic locking.
export async function mutate(path, fn, fallback) {
  for (let i = 0; i < 5; i++) {
    const old = await readJSON(path);
    const value = old ? old.value : structuredClone(fallback);
    const result = fn(value);
    try {
      await writeJSON(path, value, old ? { etag: old.etag } : { createOnly: true });
      return result === undefined ? value : result;
    } catch (e) { if (e.status !== 409) throw e; }
  }
  throw new AppError('Данные изменились в другой вкладке. Повторите.', 409);
}

// Keys under a prefix (used by the daily reminder, /stats and the owner pages).
export async function listKeys(prefix) {
  const dir = localDir();
  if (dir) {
    const files = await readdir(join(dir, prefix)).catch(() => []);
    return files.filter(f => f.endsWith('.json')).map(f => prefix + f);
  }
  const res = await call('GET', '/list?prefix=' + encodeURIComponent(prefix));
  if (res.status !== 200) throw new Error(`orvo-store LIST ${res.status}`);
  return JSON.parse(res.data.toString()).items.map(x => x.path).filter(p => p.endsWith('.json'));
}
