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
    // LEFT JOIN — main safes (branch_id IS NULL) are included.
    const sql = `SELECT s.id, s.name, s.branch_id, s.is_main, s.opening_balance_halalas, s.created_at,
                        b.name AS branch_name, br.name AS brand_name,
                        COALESCE((SELECT balance_after_halalas FROM cash_movements WHERE safe_id = s.id ORDER BY created_at DESC LIMIT 1),
                                 s.opening_balance_halalas) AS current_balance_halalas
                 FROM safes s
                 LEFT JOIN branches b ON b.id = s.branch_id
                 LEFT JOIN brands br ON br.id = b.brand_id
                 WHERE s.accountant_id = $1
                 ${branchId ? 'AND s.branch_id = $2' : ''}
                 ORDER BY s.is_main DESC, s.created_at DESC`;
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
    const opening = toHalalas(body.opening_balance);
    if (!name) throw { status: 400, message: 'name is required' };
    if (!branchId) throw { status: 400, message: 'branch_id is required' };
    if (opening < 0) throw { status: 400, message: 'opening balance cannot be negative' };
    await requireOwn('branches', branchId, me.id);

    const id = newId();
    await tx(async (q) => {
      await q(
        `INSERT INTO safes (id, branch_id, accountant_id, name, opening_balance_halalas, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, branchId, me.id, name, opening, Date.now()]
      );
      if (opening > 0) {
        await q(
          `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
           VALUES ($1, $2, 'opening', NULL, $3, $4, $5)`,
          [newId(), id, opening, opening, Date.now()]
        );
      }
    });
    await audit(me.id, 'create', 'safe', id, null, { name, branch_id: branchId, opening_balance_halalas: opening });
    send(res, 200, { id, name, branch_id: branchId, opening_balance_halalas: opening });
  },
});
