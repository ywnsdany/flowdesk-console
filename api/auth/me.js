import { readSession } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = readSession(req);
    if (!me) return send(res, 200, { authenticated: false });

    if (me.role === 'admin') {
      const row = await one('SELECT id, email, username FROM accountants WHERE id = $1', [me.id]);
      if (!row) return send(res, 200, { authenticated: false });
      return send(res, 200, {
        authenticated: true,
        role: 'admin',
        accountant: row,
        csrf: me.csrf,
      });
    }

    if (me.role === 'employee') {
      const row = await one(
        `SELECT id, name, username, status, accountant_id FROM employees WHERE id = $1`,
        [me.id]
      );
      if (!row || row.status !== 'active') return send(res, 200, { authenticated: false });
      const branches = await query(
        `SELECT b.id, b.name, br.name AS brand_name
         FROM user_branches ub
         JOIN branches b ON b.id = ub.branch_id
         JOIN brands br ON br.id = b.brand_id
         WHERE ub.employee_id = $1
         ORDER BY br.name, b.name`,
        [me.id]
      );
      return send(res, 200, {
        authenticated: true,
        role: 'employee',
        employee: { id: row.id, name: row.name, username: row.username },
        branches,
        csrf: me.csrf,
      });
    }

    return send(res, 200, { authenticated: false });
  },
});
