// List collector's own expenses.
import { requireCollector } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireCollector(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const kindFilter = req.query.kind; // 'expense' | 'purchase' | undefined
    const where = ['collector_id = $1'];
    const args = [me.id];
    if (kindFilter === 'expense' || kindFilter === 'purchase') {
      where.push('kind = $' + (args.length + 1));
      args.push(kindFilter);
    }
    args.push(limit);
    const items = await query(
      `SELECT id, amount_halalas, category, place, reason, kind, spent_at, created_at
       FROM collector_expenses
       WHERE ${where.join(' AND ')}
       ORDER BY spent_at DESC
       LIMIT $${args.length}`,
      args
    );
    send(res, 200, { items });
  },
});
