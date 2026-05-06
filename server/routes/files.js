import { verifyJwt } from '../auth.js';
import { sizeOf, streamFile } from '../storage.js';

export function mountFiles(router) {
  router.GET('/api/files', async (req, res) => {
    const t = req.query.t;
    const payload = verifyJwt(t || '');
    if (!payload || !payload.k) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const { stream, size } = streamFile(payload.k);
      const ext = payload.k.split('.').pop()?.toLowerCase();
      const ct = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' })[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': ct,
        'Content-Length': size,
        'Cache-Control': 'private, max-age=300',
      });
      stream.pipe(res);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
}
