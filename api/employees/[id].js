import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  PATCH: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('employees', id, me.id);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    const before = await one('SELECT name FROM employees WHERE id = $1', [id]);
    await query('UPDATE employees SET name = $1 WHERE id = $2', [name, id]);
    await audit(me.id, 'update', 'employee', id, before, { name });
    send(res, 200, { id, name });
  },

  DELETE: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('employees', id, me.id);
    const before = await one('SELECT name, branch_id FROM employees WHERE id = $1', [id]);
    await query('DELETE FROM employees WHERE id = $1', [id]);
    await audit(me.id, 'delete', 'employee', id, before, null);
    send(res, 200, { ok: true });
  },
});
