// Admin confirms a closing. Optionally directs the cash to a chosen safe
// (default: the closing's branch safe).

import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { requireOwn, tx } from '../../_lib/db.js';
import { newId } from '../../_lib/ids.js';
import { handler, readJson, send } from '../../_lib/http.js';
import { moveKey } from '../../_lib/blob.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('closings', id, me.id);

    const body = await readJson(req).catch(() => ({}));
    const destSafeId = body.destination_safe_id || null;

    if (destSafeId) {
      // Verify admin owns the destination safe.
      await requireOwn('safes', destSafeId, me.id);
    }

    const { closing, attachments } = await tx(async (q) => {
      const cRows = await q('SELECT * FROM closings WHERE id = $1', [id]);
      const c = cRows[0];
      if (c.status !== 'pending') throw { status: 400, message: 'هذا التقفيل ليس قيد المراجعة' };

      const cashInSafe = Number(c.cash_in_safe_halalas);
      const opening = Number(c.opening_balance_halalas);
      const useDifferent = destSafeId && destSafeId !== c.safe_id;

      // 1) Branch safe ledger entry (close of shift).
      const lastBranch = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [c.safe_id]
      );
      const branchPrev = lastBranch[0]
        ? Number(lastBranch[0].balance_after_halalas)
        : opening;
      const branchAfter = useDifferent ? opening : cashInSafe;
      const branchDelta = branchAfter - branchPrev;
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'closing_confirm', $3, $4, $5, $6)`,
        [newId(), c.safe_id, c.id, branchDelta, branchAfter, Date.now()]
      );

      // 2) If admin chose a different safe, the cash income goes there.
      if (useDifferent) {
        const cashSales = Number(c.cash_sales_halalas);
        if (cashSales > 0) {
          const lastDest = await q(
            'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
            [destSafeId]
          );
          const destOpening = await q('SELECT opening_balance_halalas FROM safes WHERE id = $1', [destSafeId]);
          const destPrev = lastDest[0]
            ? Number(lastDest[0].balance_after_halalas)
            : Number(destOpening[0].opening_balance_halalas);
          const destAfter = destPrev + cashSales;
          await q(
            `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
             VALUES ($1, $2, 'closing_route', $3, $4, $5, $6)`,
            [newId(), destSafeId, c.id, cashSales, destAfter, Date.now()]
          );
        }
      }

      // 3) Custody expense from employee balance.
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

    // Move attachments outside transaction (best-effort).
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

    await audit(me.id, 'confirm', 'closing', closing.id,
      { status: 'pending' },
      { status: 'confirmed', destination_safe_id: destSafeId || closing.safe_id });
    send(res, 200, { ok: true });
  },
});
