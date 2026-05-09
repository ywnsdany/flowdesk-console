// Collector records an expense. Deducts from wallet.

import { requireCollector, requireCsrf } from '../_lib/auth.js';
import { tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { toHalalas } from '../_lib/money.js';
import { audit } from '../_lib/audit.js';
import { handler, readJson, send } from '../_lib/http.js';

const EXPENSE_CATEGORIES  = new Set(['fuel', 'food', 'maintenance', 'transport', 'other']);
const PURCHASE_CATEGORIES = new Set(['supplies', 'equipment', 'inventory', 'other']);
const ALL_CATEGORIES = new Set([...EXPENSE_CATEGORIES, ...PURCHASE_CATEGORIES]);

export default handler({
  POST: async (req, res) => {
    const me = requireCollector(req);
    requireCsrf(req, me);
    const body = await readJson(req);

    const kind = body.kind === 'purchase' ? 'purchase' : 'expense';
    const amount = toHalalas(body.amount);
    const category = ALL_CATEGORIES.has(body.category) ? body.category : 'other';
    const place = body.place ? String(body.place).slice(0, 200) : null;
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;

    if (amount <= 0) throw { status: 400, message: 'المبلغ يجب أن يكون أكبر من صفر' };
    if (!place && !reason) throw { status: 400, message: 'أدخل المكان أو السبب على الأقل' };

    const expenseId = newId();
    const now = Date.now();

    const result = await tx(async (q) => {
      const last = await q(
        'SELECT balance_after_halalas FROM collector_movements WHERE collector_id = $1 ORDER BY created_at DESC LIMIT 1',
        [me.id]
      );
      const prev = last[0] ? Number(last[0].balance_after_halalas) : 0;
      if (prev < amount) {
        throw { status: 400, message: `رصيد محفظتك (${(prev/100).toFixed(2)} ر.س) أقل من المبلغ` };
      }
      const after = prev - amount;

      await q(
        `INSERT INTO collector_expenses (id, collector_id, accountant_id, amount_halalas, category, place, reason, kind, spent_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [expenseId, me.id, me.owner, amount, category, place, reason, kind, now, now]
      );

      await q(
        `INSERT INTO collector_movements (id, collector_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId(), me.id, kind, expenseId, -amount, after, now]
      );

      return { wallet_balance_halalas: after };
    });

    await audit(me.owner, kind, 'collector_expense', expenseId, null,
      { collector_id: me.id, amount_halalas: amount, kind, category, place, reason });

    send(res, 200, { ok: true, expense_id: expenseId, ...result });
  },
});
