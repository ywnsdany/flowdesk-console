// Admin confirms a pending transfer. Atomic: collector wallet down, main safe up.

import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { tx } from '../../_lib/db.js';
import { newId } from '../../_lib/ids.js';
import { handler, send } from '../../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    const now = Date.now();

    await tx(async (q) => {
      const rows = await q(
        'SELECT * FROM collector_transfers WHERE id = $1 AND accountant_id = $2',
        [id, me.id]
      );
      const t = rows[0];
      if (!t) throw { status: 404, message: 'not found' };
      if (t.status !== 'pending') throw { status: 400, message: 'هذا التحويل ليس قيد الانتظار' };

      const amount = Number(t.amount_halalas);

      // 1) Wallet balance check + debit.
      const lastWallet = await q(
        'SELECT balance_after_halalas FROM collector_movements WHERE collector_id = $1 ORDER BY created_at DESC LIMIT 1',
        [t.collector_id]
      );
      const walletPrev = lastWallet[0] ? Number(lastWallet[0].balance_after_halalas) : 0;
      if (walletPrev < amount) {
        throw { status: 400, message: `رصيد محفظة المحصّل (${(walletPrev/100).toFixed(2)} ر.س) أقل من المبلغ` };
      }
      const walletAfter = walletPrev - amount;
      await q(
        `INSERT INTO collector_movements (id, collector_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'transfer', $3, $4, $5, $6)`,
        [newId(), t.collector_id, t.id, -amount, walletAfter, now]
      );

      // 2) Main safe balance.
      const lastSafe = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [t.main_safe_id]
      );
      const safeOpening = await q(
        'SELECT opening_balance_halalas FROM safes WHERE id = $1',
        [t.main_safe_id]
      );
      const safePrev = lastSafe[0]
        ? Number(lastSafe[0].balance_after_halalas)
        : Number(safeOpening[0].opening_balance_halalas);
      const safeAfter = safePrev + amount;
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'transfer', $3, $4, $5, $6)`,
        [newId(), t.main_safe_id, t.id, amount, safeAfter, now]
      );

      // 3) Mark confirmed.
      await q(
        `UPDATE collector_transfers SET status = 'confirmed', reviewed_at = $1 WHERE id = $2`,
        [now, t.id]
      );
    });

    await audit(me.id, 'confirm', 'collector_transfer', id, { status: 'pending' }, { status: 'confirmed' });
    send(res, 200, { ok: true });
  },
});
