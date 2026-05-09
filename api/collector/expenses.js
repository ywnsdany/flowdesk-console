// List collector's own expenses.
import { requireCollector } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireCollector(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const items = await query(
      `SELECT id, amount_halalas, category, place, reason, spent_at, created_at
       FROM collector_expenses
       WHERE collector_id = $1
       ORDER BY spent_at DESC
       LIMIT $2`,
      [me.id, limit]
    );
    send(res, 200, { items });
  },
});
