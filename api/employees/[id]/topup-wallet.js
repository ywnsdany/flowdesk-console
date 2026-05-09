// Admin tops up a collector's wallet from the main treasury safe.
// Atomic: main_safe down, collector wallet up.

import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { tx, requireOwn } from '../../_lib/db.js';
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
    const note = body.note ? String(body.note).slice(0, 500) : null;
    if (amount <= 0) throw { status: 400, message: 'المبلغ يجب أن يكون أكبر من صفر' };

    const now = Date.now();
    const result = await tx(async (q) => {
      // 1) Verify employee belongs to me + is a collector with a wallet.
      const empRows = await q(
        'SELECT id, role, status FROM employees WHERE id = $1 AND accountant_id = $2',
        [id, me.id]
      );
      const emp = empRows[0];
      if (!emp) throw { status: 404, message: 'الموظف غير موجود' };
      if (emp.role !== 'collector') throw { status: 400, message: 'الشحن من الخزنة الرئيسية فقط للمحصّلين' };
      if (emp.status !== 'active') throw { status: 400, message: 'الحساب معطّل' };

      // 2) Find main treasury safe + verify balance.
      const mainRows = await q(
        'SELECT id, opening_balance_halalas FROM safes WHERE accountant_id = $1 AND is_main = TRUE LIMIT 1',
        [me.id]
      );
      const mainSafe = mainRows[0];
      if (!mainSafe) throw { status: 400, message: 'لا توجد خزنة رئيسية' };

      const lastSafe = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [mainSafe.id]
      );
      const safePrev = lastSafe[0]
        ? Number(lastSafe[0].balance_after_halalas)
        : Number(mainSafe.opening_balance_halalas);
      if (safePrev < amount) {
        throw { status: 400, message: `رصيد الخزنة الرئيسية (${(safePrev/100).toFixed(2)} ر.س) أقل من المبلغ` };
      }
      const safeAfter = safePrev - amount;

      // 3) Wallet balance.
      const lastWallet = await q(
        'SELECT balance_after_halalas FROM collector_movements WHERE collector_id = $1 ORDER BY created_at DESC LIMIT 1',
        [id]
      );
      const walletPrev = lastWallet[0] ? Number(lastWallet[0].balance_after_halalas) : 0;
      const walletAfter = walletPrev + amount;

      // 4) Atomic ledger entries.
      const refId = newId();
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'topup_employee', $3, $4, $5, $6)`,
        [newId(), mainSafe.id, refId, -amount, safeAfter, now]
      );
      await q(
        `INSERT INTO collector_movements (id, collector_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'topup', $3, $4, $5, $6)`,
        [newId(), id, refId, amount, walletAfter, now]
      );

      return {
        wallet_balance_halalas: walletAfter,
        main_safe_balance_halalas: safeAfter,
      };
    });

    await audit(me.id, 'topup', 'employee', id, null, { amount_halalas: amount, note });
    send(res, 200, { ok: true, ...result });
  },
});
