// Collector requests to hand over cash to admin. Pending until admin confirms.
// On submit: cash stays in collector wallet (NOT moved yet).
// On admin confirm: atomic — wallet down, main safe up.

import { requireCollector, requireCsrf } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { toHalalas } from '../_lib/money.js';
import { audit } from '../_lib/audit.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireCollector(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const amount = toHalalas(body.amount);
    const note = body.note ? String(body.note).slice(0, 500) : null;
    if (amount <= 0) throw { status: 400, message: 'المبلغ يجب أن يكون أكبر من صفر' };

    // Verify wallet has enough.
    const last = await one(
      'SELECT balance_after_halalas FROM collector_movements WHERE collector_id = $1 ORDER BY created_at DESC LIMIT 1',
      [me.id]
    );
    const balance = last ? Number(last.balance_after_halalas) : 0;
    if (balance < amount) {
      throw { status: 400, message: `رصيد محفظتك (${(balance/100).toFixed(2)} ر.س) أقل من المبلغ` };
    }

    // Find main safe for this admin.
    const mainSafe = await one(
      'SELECT id FROM safes WHERE accountant_id = $1 AND is_main = TRUE LIMIT 1',
      [me.owner]
    );
    if (!mainSafe) throw { status: 400, message: 'لا توجد خزنة رئيسية. اطلب من المدير إنشاءها.' };

    const id = newId();
    const now = Date.now();
    await one(
      `INSERT INTO collector_transfers (id, collector_id, accountant_id, main_safe_id, amount_halalas, note, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
      [id, me.id, me.owner, mainSafe.id, amount, note, now]
    );

    await audit(me.owner, 'submit', 'collector_transfer', id, null,
      { collector_id: me.id, amount_halalas: amount });

    send(res, 200, { ok: true, transfer_id: id });
  },
});
