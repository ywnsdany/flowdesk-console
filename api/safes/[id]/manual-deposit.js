// Admin manually adds cash to a safe (typically the main treasury).
// Use cases: opening balance, cash injection, reconciliation.

import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { one, query, requireOwn } from '../../_lib/db.js';
import { newId } from '../../_lib/ids.js';
import { toHalalas } from '../../_lib/money.js';
import { handler, readJson, send } from '../../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('safes', id, me.id);
    const body = await readJson(req);
    const amount = toHalalas(body.amount);
    const note = body.note ? String(body.note).slice(0, 500) : null;
    if (amount === 0) throw { status: 400, message: 'المبلغ مطلوب' };

    const safe = await one('SELECT id, opening_balance_halalas FROM safes WHERE id = $1', [id]);
    if (!safe) throw { status: 404, message: 'not found' };

    const last = await one(
      'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
      [id]
    );
    const prev = last ? Number(last.balance_after_halalas) : Number(safe.opening_balance_halalas);
    const after = prev + amount;
    if (after < 0) throw { status: 400, message: 'الرصيد لا يمكن أن يكون سالباً' };

    const refId = newId();
    await query(
      `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
       VALUES ($1, $2, 'adjustment', $3, $4, $5, $6)`,
      [newId(), id, refId, amount, after, Date.now()]
    );
    await audit(me.id, 'manual_deposit', 'safe', id, null, { amount_halalas: amount, note });

    send(res, 200, { ok: true, balance_halalas: after });
  },
});
