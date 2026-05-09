// Admin rejects a pending transfer. No money movement (cash never left collector).

import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { one, query } from '../../_lib/db.js';
import { handler, readJson, send } from '../../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    const body = await readJson(req);
    const reason = String(body.reason || '').trim();
    if (!reason) throw { status: 400, message: 'السبب مطلوب' };

    const t = await one(
      'SELECT id, status FROM collector_transfers WHERE id = $1 AND accountant_id = $2',
      [id, me.id]
    );
    if (!t) throw { status: 404, message: 'not found' };
    if (t.status !== 'pending') throw { status: 400, message: 'هذا التحويل ليس قيد الانتظار' };

    await query(
      `UPDATE collector_transfers SET status = 'rejected', reject_reason = $1, reviewed_at = $2 WHERE id = $3`,
      [reason, Date.now(), id]
    );
    await audit(me.id, 'reject', 'collector_transfer', id, { status: 'pending' }, { status: 'rejected', reason });
    send(res, 200, { ok: true });
  },
});
