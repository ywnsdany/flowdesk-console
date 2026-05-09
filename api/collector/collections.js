// List collector's own collections.
import { requireCollector } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireCollector(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const items = await query(
      `SELECT c.id, c.amount_halalas, c.collected_at, c.note, c.created_at,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name
       FROM collections c
       JOIN branches b  ON b.id = c.branch_id
       JOIN brands   br ON br.id = b.brand_id
       JOIN safes    s  ON s.id = c.safe_id
       WHERE c.collector_id = $1
       ORDER BY c.collected_at DESC
       LIMIT $2`,
      [me.id, limit]
    );
    send(res, 200, { items });
  },
});
