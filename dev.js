// Local server: static files from public/ plus the same API that runs on Vercel.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from './lib/router.js';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT || 4100);

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/api/')) return handle(req, res);
  const pages = { '/': 'index.html', '/authorize': 'authorize.html', '/me': 'index.html', '/projects': 'index.html' };
  const file = pages[path] || normalize(path).replace(/^\/+/, '');
  try {
    const data = await readFile(join('public', file));
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(port, () => console.log(`orvo ID: http://localhost:${port}`));
