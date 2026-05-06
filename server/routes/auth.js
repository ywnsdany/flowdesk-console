import { authCookies, clearAuthCookies, hashPassword, readAccountant, requireAccountant, requireCsrf, verifyPassword } from '../auth.js';
import { getDb } from '../db.js';
import { newId } from '../ids.js';
import { getClientIp, readJson, send } from '../router.js';

const SIGNUP_RATE_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export function mountAuth(router) {
  router.POST('/api/auth/signup', async (req, res) => {
    const ip = getClientIp(req);
    const db = getDb();
    const cutoff = Date.now() - SIGNUP_WINDOW_MS;
    const recent = db.prepare('SELECT COUNT(*) AS c FROM signup_attempts WHERE ip = ? AND created_at > ?').get(ip, cutoff).c;
    if (recent >= SIGNUP_RATE_LIMIT) {
      throw { status: 429, message: 'too many signups from this IP, try again later' };
    }
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw { status: 400, message: 'invalid email' };
    if (password.length < 10) throw { status: 400, message: 'password must be at least 10 characters' };

    db.prepare('INSERT INTO signup_attempts (ip, created_at) VALUES (?, ?)').run(ip, Date.now());

    const exists = db.prepare('SELECT id FROM accountants WHERE email = ?').get(email);
    if (exists) throw { status: 409, message: 'email already registered' };

    const id = newId();
    const { salt, hash } = hashPassword(password);
    db.prepare(
      'INSERT INTO accountants (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, email, hash, salt, Date.now());

    const cookies = authCookies(id);
    send(res, 200, { id, email }, { 'Set-Cookie': cookies });
  });

  router.POST('/api/auth/login', async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) throw { status: 400, message: 'missing email or password' };

    const row = getDb().prepare('SELECT id, password_hash, password_salt FROM accountants WHERE email = ?').get(email);
    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      throw { status: 401, message: 'invalid email or password' };
    }

    const cookies = authCookies(row.id);
    send(res, 200, { id: row.id, email }, { 'Set-Cookie': cookies });
  });

  router.POST('/api/auth/logout', async (req, res) => {
    send(res, 200, { ok: true }, { 'Set-Cookie': clearAuthCookies() });
  });

  router.GET('/api/auth/me', async (req, res) => {
    const me = readAccountant(req);
    if (!me) return send(res, 200, { authenticated: false });
    const row = getDb().prepare('SELECT id, email FROM accountants WHERE id = ?').get(me.id);
    if (!row) return send(res, 200, { authenticated: false });
    send(res, 200, { authenticated: true, accountant: row, csrf: me.csrf });
  });

  router.POST('/api/auth/change-password', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const current = String(body.current_password || '');
    const next = String(body.new_password || '');
    if (next.length < 10) throw { status: 400, message: 'new password must be at least 10 characters' };
    const row = getDb().prepare('SELECT password_hash, password_salt FROM accountants WHERE id = ?').get(me.id);
    if (!row || !verifyPassword(current, row.password_salt, row.password_hash)) {
      throw { status: 401, message: 'current password is incorrect' };
    }
    const { salt, hash } = hashPassword(next);
    getDb().prepare('UPDATE accountants SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, me.id);
    send(res, 200, { ok: true });
  });
}
