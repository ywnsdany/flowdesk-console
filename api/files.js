import { verifyJwt } from './_lib/auth.js';
import { urlOf } from './_lib/blob.js';

// Resolves a signed token to a Vercel Blob URL and 302-redirects to it.
// The blob is publicly accessible by URL — JWT only gates whether we reveal the URL.
export default async function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  const t = (req.query && req.query.t) || '';
  const payload = verifyJwt(t || '');
  if (!payload || !payload.k) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  const url = await urlOf(payload.k);
  if (!url) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  res.writeHead(302, {
    Location: url,
    'Cache-Control': 'private, max-age=300',
  });
  res.end();
}
