// Admin: list collector transfers (pending by default).
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const status = req.query.status || 'pending';
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const where = ['t.accountant_id = $1'];
    const args = [me.id];
    if (status && status !== 'all') {
      where.push('t.status = $' + (args.length + 1));
      args.push(status);
    }
    args.push(limit);
    const items = await query(
      `SELECT t.id, t.amount_halalas, t.note, t.status, t.reject_reason,
              t.submitted_at, t.reviewed_at,
              e.name AS collector_name, e.username AS collector_username,
              s.name AS safe_name
       FROM collector_transfers t
       JOIN employees e ON e.id = t.collector_id
       JOIN safes s     ON s.id = t.main_safe_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.submitted_at DESC
       LIMIT $${args.length}`,
      args
    );
    send(res, 200, { items });
  },
});
