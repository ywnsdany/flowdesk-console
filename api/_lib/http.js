// HTTP helpers for Vercel serverless handlers.

export function send(res, status, body, headers = {}) {
  const isJson = body && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : (body ?? '');
  const final = {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : (headers['Content-Type'] || 'text/plain; charset=utf-8'),
    ...headers,
  };
  res.writeHead(status, final);
  res.end(payload);
}

export function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Read parsed JSON body. On Vercel Node runtime, req.body is auto-parsed when content-type is JSON.
// For multipart routes that disable bodyParser, use parseMultipart() instead.
export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw { status: 400, message: 'invalid json' }; }
  }
  // Fallback: read stream.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw { status: 400, message: 'invalid json' }; }
}

// Wraps a handler with method-dispatch + error handling.
// Usage:
//   export default handler({
//     GET: async (req, res) => { ... },
//     POST: async (req, res) => { ... },
//   });
export function handler(methods) {
  return async (req, res) => {
    try {
      const fn = methods[req.method];
      if (!fn) {
        res.setHeader('Allow', Object.keys(methods).join(', '));
        return send(res, 405, { error: 'method not allowed' });
      }
      await fn(req, res);
    } catch (err) {
      const status = err?.status || 500;
      if (status >= 500) console.error('[handler]', err);
      send(res, status, { error: err?.message || 'server error' });
    }
  };
}
