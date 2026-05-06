import { hashPassword, requireAccountant, requireCsrf, verifyPassword } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const current = String(body.current_password || '');
    const next = String(body.new_password || '');
    if (next.length < 10) throw { status: 400, message: 'new password must be at least 10 characters' };
    const row = await one('SELECT password_hash, password_salt FROM accountants WHERE id = $1', [me.id]);
    if (!row || !verifyPassword(current, row.password_salt, row.password_hash)) {
      throw { status: 401, message: 'current password is incorrect' };
    }
    const { salt, hash } = hashPassword(next);
    await query('UPDATE accountants SET password_hash = $1, password_salt = $2 WHERE id = $3', [hash, salt, me.id]);
    send(res, 200, { ok: true });
  },
});
