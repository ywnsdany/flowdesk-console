import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { query, requireOwn, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { toHalalas } from '../_lib/money.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const branchId = req.query.branch_id;
    const sql = `SELECT e.id, e.name, e.branch_id, e.custody_balance_halalas, e.created_at,
                        b.name AS branch_name, br.name AS brand_name
                 FROM employees e JOIN branches b ON b.id = e.branch_id JOIN brands br ON br.id = b.brand_id
                 WHERE e.accountant_id = $1
                 ${branchId ? 'AND e.branch_id = $2' : ''}
                 ORDER BY e.created_at DESC`;
    const rows = branchId
      ? await query(sql, [me.id, branchId])
      : await query(sql, [me.id]);
    send(res, 200, { items: rows });
  },

  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const branchId = String(body.branch_id || '').trim();
    const custody = toHalalas(body.custody_balance);
    if (!name) throw { status: 400, message: 'name is required' };
    if (!branchId) throw { status: 400, message: 'branch_id is required' };
    if (custody < 0) throw { status: 400, message: 'custody balance cannot be negative' };
    await requireOwn('branches', branchId, me.id);

    const id = newId();
    await tx(async (q) => {
      await q(
        'INSERT INTO employees (id, branch_id, accountant_id, name, custody_balance_halalas, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, branchId, me.id, name, custody, Date.now()]
      );
      if (custody > 0) {
        await q(
          `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
           VALUES ($1, $2, 'opening', NULL, $3, $4, $5)`,
          [newId(), id, custody, custody, Date.now()]
        );
      }
    });
    await audit(me.id, 'create', 'employee', id, null, { name, branch_id: branchId, custody_balance_halalas: custody });
    send(res, 200, { id, name, branch_id: branchId, custody_balance_halalas: custody });
  },
});
