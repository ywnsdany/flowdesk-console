import { requireAccountant } from '../../_lib/auth.js';
import { query, requireOwn } from '../../_lib/db.js';
import { handler, send } from '../../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const id = String(req.query.id);
    await requireOwn('safes', id, me.id);
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
    const rows = await query(
      `SELECT id, type, ref_id, amount_halalas, balance_after_halalas, created_at
       FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [id, limit]
    );
    send(res, 200, { items: rows });
  },
});
