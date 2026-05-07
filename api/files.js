// Streams a stored file after verifying a short-lived signed token.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { verifyJwt } from './_lib/auth.js';
import { localPath } from './_lib/blob.js';

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf',
};

export default async function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  const t = (req.query && req.query.t) || '';
  const payload = verifyJwt(t);
  if (!payload || !payload.k) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }
  const fp = localPath(payload.k);
  if (!existsSync(fp)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  }
  const ext = payload.k.split('.').pop()?.toLowerCase() || '';
  const ct = MIME[ext] || 'application/octet-stream';
  const size = statSync(fp).size;
  res.writeHead(200, {
    'Content-Type': ct,
    'Content-Length': size,
    'Cache-Control': 'private, max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(fp).pipe(res);
}
