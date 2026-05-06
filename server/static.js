import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const PUBLIC = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function tryServeStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  // Normalize and prevent traversal.
  const safe = normalize(rel).replace(/^([\\/])+/, '');
  const fp = resolve(PUBLIC, safe);
  if (!fp.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('forbidden'); return true;
  }
  let path = fp;
  if (existsSync(path)) {
    const st = statSync(path);
    if (st.isDirectory()) {
      const idx = join(path, 'index.html');
      if (existsSync(idx)) path = idx;
      else return false;
    }
  } else if (!rel.includes('.') && existsSync(fp + '.html')) {
    path = fp + '.html';
  } else {
    return false;
  }
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  const st = statSync(path);
  res.writeHead(200, {
    'Content-Type': ct,
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(path).pipe(res);
  return true;
}
