import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const PBKDF2_ITERS = 310000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET env var is required (32+ chars)');
  }
  return Buffer.from(s);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64');
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('base64');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const got = pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const want = Buffer.from(expectedHash, 'base64');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function hashPin(pin) {
  const salt = randomBytes(16).toString('base64');
  const hash = pbkdf2Sync(String(pin), salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString('base64');
  return { salt, hash };
}

export function verifyPin(pin, salt, expectedHash) {
  const got = pbkdf2Sync(String(pin), salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const want = Buffer.from(expectedHash, 'base64');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

// JWT HS256.
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export function signJwt(payload, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = createHmac('sha256', secret()).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64url(sig)}`;
}

export function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const sig = createHmac('sha256', secret()).update(`${h}.${p}`).digest();
  const expected = b64urlDecode(s);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

const COOKIE_AUTH = 'cc_auth';
const COOKIE_CSRF = 'cc_csrf';

// Issues both auth cookies. role: 'admin' | 'employee'.
// For employees, accountantId is the parent admin (for ownership / queries scope).
export function authCookies(userId, opts = {}) {
  const csrf = randomBytes(24).toString('base64url');
  const role = opts.role || 'admin';
  const ownerId = opts.ownerId || userId;
  const token = signJwt({ sub: userId, role, owner: ownerId, csrf }, 60 * 60 * 24 * 7);
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secure = isProd ? ' Secure;' : '';
  return [
    `${COOKIE_AUTH}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
    `${COOKIE_CSRF}=${csrf}; Path=/;${secure} SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`,
  ];
}

export function clearAuthCookies() {
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const secure = isProd ? ' Secure;' : '';
  return [
    `${COOKIE_AUTH}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`,
    `${COOKIE_CSRF}=; Path=/;${secure} SameSite=Lax; Max-Age=0`,
  ];
}

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

export function getCookie(req, name) {
  if (req.cookies && typeof req.cookies === 'object' && name in req.cookies) {
    return req.cookies[name];
  }
  const parsed = parseCookies(req.headers?.cookie);
  return parsed[name] || null;
}

// Returns { id, role, owner, csrf } or null. role defaults to 'admin' for old tokens.
export function readSession(req) {
  const token = getCookie(req, COOKIE_AUTH);
  if (!token) return null;
  const payload = verifyJwt(token);
  if (!payload?.sub) return null;
  return {
    id: payload.sub,
    role: payload.role || 'admin',
    owner: payload.owner || payload.sub,
    csrf: payload.csrf,
  };
}

// Admin (accountant) only.
export function readAccountant(req) {
  const me = readSession(req);
  if (!me || me.role !== 'admin') return null;
  return { id: me.id, csrf: me.csrf };
}

export function requireAccountant(req) {
  const me = readAccountant(req);
  if (!me) throw { status: 401, message: 'unauthorized' };
  return me;
}

// Employee only.
export function readEmployee(req) {
  const me = readSession(req);
  if (!me || me.role !== 'employee') return null;
  return { id: me.id, owner: me.owner, csrf: me.csrf };
}

export function requireEmployee(req) {
  const me = readEmployee(req);
  if (!me) throw { status: 401, message: 'unauthorized' };
  return me;
}

export function requireCsrf(req, me) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const header = req.headers['x-csrf-token'];
  if (!header || !me?.csrf) throw { status: 403, message: 'missing csrf' };
  const a = Buffer.from(String(header));
  const b = Buffer.from(me.csrf);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw { status: 403, message: 'bad csrf' };
  }
}

// Either admin or employee — useful for /api/auth/me and shared endpoints.
export function readAnySession(req) { return readSession(req); }
