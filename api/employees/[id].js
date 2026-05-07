import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn, tx } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  PATCH: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('employees', id, me.id);
    const body = await readJson(req);

    const before = await one(
      'SELECT name, status FROM employees WHERE id = $1',
      [id]
    );
    const updates = [];
    const args = [];
    let i = 1;

    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name) throw { status: 400, message: 'الاسم مطلوب' };
      updates.push(`name = $${i++}`); args.push(name);
    }
    if (body.status != null) {
      const status = body.status === 'disabled' ? 'disabled' : 'active';
      updates.push(`status = $${i++}`); args.push(status);
    }
    if (updates.length) {
      args.push(id);
      await query(`UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}`, args);
    }

    // Handle branch_ids: full replacement.
    if (Array.isArray(body.branch_ids)) {
      for (const bid of body.branch_ids) await requireOwn('branches', bid, me.id);
      await tx(async (q) => {
        await q('DELETE FROM user_branches WHERE employee_id = $1', [id]);
        for (const bid of body.branch_ids) {
          await q(
            'INSERT INTO user_branches (employee_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, bid]
          );
        }
        if (body.branch_ids[0]) {
          await q('UPDATE employees SET branch_id = $1 WHERE id = $2', [body.branch_ids[0], id]);
        }
      });
    }

    await audit(me.id, 'update', 'employee', id, before, body);
    send(res, 200, { ok: true });
  },

  DELETE: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('employees', id, me.id);
    const before = await one('SELECT name FROM employees WHERE id = $1', [id]);
    await query('DELETE FROM employees WHERE id = $1', [id]);
    await audit(me.id, 'delete', 'employee', id, before, null);
    send(res, 200, { ok: true });
  },
});
