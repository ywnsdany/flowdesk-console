import { hashPassword, requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { query, requireOwn } from '../../_lib/db.js';
import { handler, readJson, send } from '../../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('employees', id, me.id);
    const body = await readJson(req);
    const password = String(body.password || '');
    if (password.length < 6) throw { status: 400, message: 'كلمة المرور ٦ أحرف على الأقل' };
    const { salt, hash } = hashPassword(password);
    await query(
      'UPDATE employees SET password_hash = $1, password_salt = $2 WHERE id = $3',
      [hash, salt, id]
    );
    await audit(me.id, 'reset_password', 'employee', id, null, null);
    send(res, 200, { ok: true });
  },
});
