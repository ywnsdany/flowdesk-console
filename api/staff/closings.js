// Employee's own closings list (paginated, last N).
import { requireEmployee } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireEmployee(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const rows = await query(
      `SELECT c.id, c.status, c.submitted_at, c.closing_date, c.reviewed_at,
              c.total_sales_halalas, c.cash_in_safe_halalas, c.variance_halalas,
              c.reject_reason,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       WHERE c.employee_id = $1
       ORDER BY c.submitted_at DESC
       LIMIT $2`,
      [me.id, limit]
    );
    send(res, 200, { items: rows });
  },
});
