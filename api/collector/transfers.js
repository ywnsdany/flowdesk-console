// Collector's own transfer history.
import { requireCollector } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireCollector(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const items = await query(
      `SELECT id, amount_halalas, note, status, reject_reason, submitted_at, reviewed_at
       FROM collector_transfers
       WHERE collector_id = $1
       ORDER BY submitted_at DESC
       LIMIT $2`,
      [me.id, limit]
    );
    send(res, 200, { items });
  },
});
