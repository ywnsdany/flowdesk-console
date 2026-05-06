import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { requireOwn, tx } from '../../_lib/db.js';
import { newId } from '../../_lib/ids.js';
import { handler, send } from '../../_lib/http.js';
import { moveKey } from '../../_lib/blob.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('closings', id, me.id);

    // Step 1: load + ledger inserts inside a transaction.
    const { closing, attachments } = await tx(async (q) => {
      const cRows = await q('SELECT * FROM closings WHERE id = $1', [id]);
      const c = cRows[0];
      if (c.status !== 'pending') throw { status: 400, message: 'closing is not pending' };

      const lastRows = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [c.safe_id]
      );
      const prevBalance = lastRows[0]
        ? Number(lastRows[0].balance_after_halalas)
        : Number(c.opening_balance_halalas);
      const cashInSafe = Number(c.cash_in_safe_halalas);
      const delta = cashInSafe - prevBalance;
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'closing_confirm', $3, $4, $5, $6)`,
        [newId(), c.safe_id, c.id, delta, cashInSafe, Date.now()]
      );

      if (c.employee_id && Number(c.custody_expense_halalas) > 0) {
        const empRows = await q('SELECT custody_balance_halalas FROM employees WHERE id = $1', [c.employee_id]);
        const newBal = Number(empRows[0].custody_balance_halalas) - Number(c.custody_expense_halalas);
        await q('UPDATE employees SET custody_balance_halalas = $1 WHERE id = $2', [newBal, c.employee_id]);
        await q(
          `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
           VALUES ($1, $2, 'expense', $3, $4, $5, $6)`,
          [newId(), c.employee_id, c.id, -Number(c.custody_expense_halalas), newBal, Date.now()]
        );
      }

      const atts = await q('SELECT id, storage_key FROM attachments WHERE closing_id = $1', [c.id]);

      await q('UPDATE closings SET status = $1, reviewed_at = $2 WHERE id = $3', ['confirmed', Date.now(), c.id]);
      return { closing: c, attachments: atts };
    });

    // Step 2: blob storage move (outside transaction — best-effort; DB key gets updated).
    for (const a of attachments) {
      if (a.storage_key && a.storage_key.startsWith('pending/')) {
        const filename = a.storage_key.split('/').pop();
        const newKey = `confirmed/${closing.id}/${filename}`;
        try {
          await moveKey(a.storage_key, newKey);
          await tx(async (q) => {
            await q('UPDATE attachments SET storage_key = $1 WHERE id = $2', [newKey, a.id]);
          });
        } catch (err) {
          console.error('[blob.move]', err);
        }
      }
    }

    await audit(me.id, 'confirm', 'closing', closing.id, { status: 'pending' }, { status: 'confirmed' });
    send(res, 200, { ok: true });
  },
});
