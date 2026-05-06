import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { requireOwn, tx } from '../../_lib/db.js';
import { newId } from '../../_lib/ids.js';
import { toHalalas } from '../../_lib/money.js';
import { handler, readJson, send } from '../../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('employees', id, me.id);
    const body = await readJson(req);
    const amount = toHalalas(body.amount);
    if (amount <= 0) throw { status: 400, message: 'amount must be positive' };
    await tx(async (q) => {
      const rows = await q('SELECT custody_balance_halalas FROM employees WHERE id = $1', [id]);
      const cur = Number(rows[0].custody_balance_halalas);
      const newBalance = cur + amount;
      await q('UPDATE employees SET custody_balance_halalas = $1 WHERE id = $2', [newBalance, id]);
      await q(
        `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'topup', NULL, $3, $4, $5)`,
        [newId(), id, amount, newBalance, Date.now()]
      );
    });
    await audit(me.id, 'topup', 'employee', id, null, { amount });
    send(res, 200, { ok: true });
  },
});
