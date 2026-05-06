#!/usr/bin/env node
// Local dev server that mimics Vercel's file-based routing.
// Serves api/**/*.js as Node.js handlers and public/ statically.
//
// Usage: node scripts/dev-server.js  (requires DATABASE_URL + JWT_SECRET in env)

import http from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const API_DIR = join(ROOT, 'api');
const PUBLIC_DIR = join(ROOT, 'public');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ----------------------------------------------------------------------------
// Discover API routes — convert file paths to URL patterns
// ----------------------------------------------------------------------------

function walkApi(dir, prefix = '/api') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue; // skip _lib
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      const seg = entry.startsWith('[') && entry.endsWith(']') ? `:${entry.slice(1, -1)}` : entry;
      out.push(...walkApi(full, `${prefix}/${seg}`));
    } else if (entry.endsWith('.js')) {
      const base = entry.replace(/\.js$/, '');
      let urlSeg;
      if (base === 'index') urlSeg = '';
      else if (base.startsWith('[') && base.endsWith(']')) urlSeg = `/:${base.slice(1, -1)}`;
      else urlSeg = `/${base}`;
      out.push({ pattern: prefix + urlSeg, file: full });
    }
  }
  return out;
}

const ROUTES = walkApi(API_DIR).map((r) => ({
  ...r,
  re: new RegExp('^' + r.pattern.replace(/\.csv/g, '\\.csv').replace(/:(\w+)/g, '([^/]+)') + '/?$'),
  keys: [...r.pattern.matchAll(/:(\w+)/g)].map((m) => m[1]),
}));

console.log(`Discovered ${ROUTES.length} API routes:`);
for (const r of ROUTES) console.log(`  ${r.pattern}  →  ${relative(ROOT, r.file)}`);

// ----------------------------------------------------------------------------
// Static MIME map
// ----------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

function tryStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/console/';
  if (rel === '/console') rel = '/console/';
  if (rel === '/cashier') rel = '/cashier/';
  if (rel.endsWith('/')) rel += 'index.html';

  let path = join(PUBLIC_DIR, rel);
  // clean URLs: try with .html if no extension
  if (!existsSync(path) && !rel.includes('.')) {
    if (existsSync(path + '.html')) path = path + '.html';
  }
  if (!existsSync(path)) return false;
  const st = statSync(path);
  if (st.isDirectory()) {
    const idx = join(path, 'index.html');
    if (existsSync(idx)) path = idx;
    else return false;
  }
  if (!path.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return true; }

  const ext = extname(path).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': statSync(path).size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(path).pipe(res);
  return true;
}

// ----------------------------------------------------------------------------
// Cookie + query parsing (Vercel runtime auto-parses these)
// ----------------------------------------------------------------------------

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function readBodyMaybe(req) {
  // For multipart, leave the stream alone — handlers parse it.
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return undefined;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (!buf.length) return {};
  if (ct.includes('application/json')) {
    try { return JSON.parse(buf.toString('utf8')); } catch { return {}; }
  }
  return buf.toString('utf8');
}

// ----------------------------------------------------------------------------
// Server
// ----------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      let matched = null;
      for (const r of ROUTES) {
        const m = path.match(r.re);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        matched = { route: r, params };
        break;
      }
      if (!matched) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'not found' }));
      }
      // Build a Vercel-like req object.
      req.cookies = parseCookies(req.headers.cookie);
      req.query = { ...Object.fromEntries(url.searchParams.entries()), ...matched.params };
      req.body = await readBodyMaybe(req);

      const mod = await import(pathToFileURL(matched.route.file).href);
      const handler = mod.default;
      if (typeof handler !== 'function') {
        res.writeHead(500); return res.end('handler is not a function');
      }
      try { await handler(req, res); }
      catch (err) {
        console.error(`[${path}]`, err);
        if (!res.headersSent) {
          res.writeHead(err?.status || 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message || 'server error' }));
        }
      }
      return;
    }

    if (tryStatic(req, res, path)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server error' }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 dev server: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  if (!process.env.DATABASE_URL) console.warn('⚠  DATABASE_URL is not set — API calls will fail.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.warn('⚠  JWT_SECRET is missing or too short — auth will fail.');
  }
});
