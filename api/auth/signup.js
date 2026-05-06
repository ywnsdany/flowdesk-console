import { authCookies, hashPassword } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { getClientIp, handler, readJson, send } from '../_lib/http.js';

const SIGNUP_RATE_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export default handler({
  POST: async (req, res) => {
    const ip = getClientIp(req);
    const cutoff = Date.now() - SIGNUP_WINDOW_MS;
    const recent = await one(
      'SELECT COUNT(*)::int AS c FROM signup_attempts WHERE ip = $1 AND created_at > $2',
      [ip, cutoff]
    );
    if (recent.c >= SIGNUP_RATE_LIMIT) {
      throw { status: 429, message: 'too many signups from this IP, try again later' };
    }
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw { status: 400, message: 'invalid email' };
    if (password.length < 10) throw { status: 400, message: 'password must be at least 10 characters' };

    await query('INSERT INTO signup_attempts (ip, created_at) VALUES ($1, $2)', [ip, Date.now()]);

    const exists = await one('SELECT id FROM accountants WHERE email = $1', [email]);
    if (exists) throw { status: 409, message: 'email already registered' };

    const id = newId();
    const { salt, hash } = hashPassword(password);
    await query(
      'INSERT INTO accountants (id, email, password_hash, password_salt, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, email, hash, salt, Date.now()]
    );

    send(res, 200, { id, email }, { 'Set-Cookie': authCookies(id) });
  },
});
