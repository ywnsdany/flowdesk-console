import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { handler, send } from '../_lib/http.js';
import { deleteKey } from '../_lib/blob.js';

export default handler({
  DELETE: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    const row = await one('SELECT * FROM bank_deposits WHERE id = $1', [id]);
    if (!row) throw { status: 404, message: 'not found' };
    if (row.accountant_id !== me.id) throw { status: 403, message: 'forbidden' };

    await tx(async (q) => {
      const lastRows = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [row.safe_id]
      );
      const prev = lastRows[0] ? Number(lastRows[0].balance_after_halalas) : 0;
      const newBal = prev + Number(row.amount_halalas);
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'adjustment', $3, $4, $5, $6)`,
        [newId(), row.safe_id, id, Number(row.amount_halalas), newBal, Date.now()]
      );
      await q('DELETE FROM bank_deposits WHERE id = $1', [id]);
    });

    if (row.receipt_storage_key) {
      try { await deleteKey(row.receipt_storage_key); } catch {}
    }
    await audit(me.id, 'delete', 'bank_deposit', id, row, null);
    send(res, 200, { ok: true });
  },
});
