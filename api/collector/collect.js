// Collector picks up cash from a branch's safe.
// Atomic: cash leaves the safe (cash_movements), enters wallet (collector_movements).

import { requireCollector, requireCsrf } from '../_lib/auth.js';
import { one, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { toHalalas } from '../_lib/money.js';
import { audit } from '../_lib/audit.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireCollector(req);
    requireCsrf(req, me);
    const body = await readJson(req);

    const branchId = String(body.branch_id || '');
    const safeId = String(body.safe_id || '');
    const amount = toHalalas(body.amount);
    const note = body.note ? String(body.note).slice(0, 500) : null;

    if (!branchId || !safeId) throw { status: 400, message: 'الفرع والخزنة مطلوبين' };
    if (amount <= 0) throw { status: 400, message: 'المبلغ يجب أن يكون أكبر من صفر' };

    // Auth: collector must be assigned to this branch.
    const allowed = await one(
      'SELECT 1 AS ok FROM user_branches WHERE employee_id = $1 AND branch_id = $2',
      [me.id, branchId]
    );
    if (!allowed) throw { status: 403, message: 'غير مصرّح بهذا الفرع' };

    // Verify safe ↔ branch ↔ admin owner.
    const safe = await one(
      `SELECT s.id, s.branch_id, s.accountant_id, s.opening_balance_halalas
       FROM safes s WHERE s.id = $1`,
      [safeId]
    );
    if (!safe || safe.branch_id !== branchId || safe.accountant_id !== me.owner) {
      throw { status: 400, message: 'الخزنة لا تنتمي للفرع المحدد' };
    }

    const collectionId = newId();
    const now = Date.now();

    const result = await tx(async (q) => {
      // 1) Read current safe balance.
      const lastSafe = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [safe.id]
      );
      const safePrev = lastSafe[0]
        ? Number(lastSafe[0].balance_after_halalas)
        : Number(safe.opening_balance_halalas);
      const safeAfter = safePrev - amount;
      if (safeAfter < 0) {
        throw { status: 400, message: `رصيد الخزنة (${(safePrev/100).toFixed(2)} ر.س) أقل من المبلغ` };
      }

      // 2) Read current wallet balance.
      const lastWallet = await q(
        'SELECT balance_after_halalas FROM collector_movements WHERE collector_id = $1 ORDER BY created_at DESC LIMIT 1',
        [me.id]
      );
      const walletPrev = lastWallet[0] ? Number(lastWallet[0].balance_after_halalas) : 0;
      const walletAfter = walletPrev + amount;

      // 3) Insert collection record.
      await q(
        `INSERT INTO collections (id, collector_id, accountant_id, branch_id, safe_id, amount_halalas, collected_at, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [collectionId, me.id, me.owner, branchId, safe.id, amount, now, note, now]
      );

      // 4) Cash movement on the safe (cash leaves).
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'collection', $3, $4, $5, $6)`,
        [newId(), safe.id, collectionId, -amount, safeAfter, now]
      );

      // 5) Wallet movement (cash enters).
      await q(
        `INSERT INTO collector_movements (id, collector_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'collection', $3, $4, $5, $6)`,
        [newId(), me.id, collectionId, amount, walletAfter, now]
      );

      return { wallet_balance_halalas: walletAfter, safe_balance_halalas: safeAfter };
    });

    await audit(me.owner, 'collect', 'collection', collectionId, null,
      { collector_id: me.id, safe_id: safeId, amount_halalas: amount });

    send(res, 200, { ok: true, collection_id: collectionId, ...result });
  },
});
