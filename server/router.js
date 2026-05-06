// Tiny router: register handlers, dispatch by method+path with simple :param matching.

export function createRouter() {
  const routes = [];
  function add(method, pattern, handler) {
    const re = patternToRegex(pattern);
    routes.push({ method, re, keys: extractKeys(pattern), handler });
  }
  return {
    GET: (p, h) => add('GET', p, h),
    POST: (p, h) => add('POST', p, h),
    PUT: (p, h) => add('PUT', p, h),
    PATCH: (p, h) => add('PATCH', p, h),
    DELETE: (p, h) => add('DELETE', p, h),
    match(method, path) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
      return null;
    },
  };
}

function patternToRegex(pattern) {
  const parts = pattern.split('/').map((p) => {
    if (p.startsWith(':')) return '([^/]+)';
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^' + parts.join('/') + '/?$');
}
function extractKeys(pattern) {
  return pattern.split('/').filter((p) => p.startsWith(':')).map((p) => p.slice(1));
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

export async function readJson(req, maxBytes = 1024 * 1024) {
  const buf = await readBody(req, maxBytes);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw { status: 400, message: 'invalid json' };
  }
}

export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject({ status: 413, message: 'payload too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function send(res, status, body, headers = {}) {
  const isJson = body && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body ?? '';
  const final = {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : (headers['Content-Type'] || 'text/plain; charset=utf-8'),
    ...headers,
  };
  res.writeHead(status, final);
  res.end(payload);
}

export function getClientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}
