import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const status = req.query.status;
    const branchId = req.query.branch_id;
    const safeId = req.query.safe_id;
    const from = req.query.from ? parseInt(req.query.from, 10) : null;
    const to = req.query.to ? parseInt(req.query.to, 10) : null;
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);

    const where = ['c.accountant_id = $1'];
    const args = [me.id];
    let i = 2;
    if (status) { where.push(`c.status = $${i++}`); args.push(status); }
    if (branchId) { where.push(`c.branch_id = $${i++}`); args.push(branchId); }
    if (safeId) { where.push(`c.safe_id = $${i++}`); args.push(safeId); }
    if (from) { where.push(`c.submitted_at >= $${i++}`); args.push(from); }
    if (to) { where.push(`c.submitted_at <= $${i++}`); args.push(to); }
    args.push(limit);

    const rows = await query(
      `SELECT c.id, c.status, c.submitted_at, c.reviewed_at,
              c.total_sales_halalas, c.network_sales_halalas, c.apps_sales_halalas, c.cash_sales_halalas,
              c.cash_in_safe_halalas, c.expected_cash_halalas, c.variance_halalas,
              c.custody_expense_halalas, c.notes, c.reject_reason,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.submitted_at DESC
       LIMIT $${i}`,
      args
    );
    send(res, 200, { items: rows });
  },
});
