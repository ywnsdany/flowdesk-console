import { authCookies, verifyPassword } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) throw { status: 400, message: 'missing email or password' };

    const row = await one('SELECT id, password_hash, password_salt FROM accountants WHERE email = $1', [email]);
    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      throw { status: 401, message: 'invalid email or password' };
    }

    send(res, 200, { id: row.id, email }, { 'Set-Cookie': authCookies(row.id) });
  },
});
