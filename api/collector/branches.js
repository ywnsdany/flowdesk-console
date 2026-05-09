// Branches the logged-in collector is assigned to, with each safe + current balance.
import { requireCollector } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireCollector(req);
    const branches = await query(
      `SELECT b.id, b.name, br.name AS brand_name
       FROM user_branches ub
       JOIN branches b ON b.id = ub.branch_id
       JOIN brands br ON br.id = b.brand_id
       WHERE ub.employee_id = $1
       ORDER BY br.name, b.name`,
      [me.id]
    );
    if (!branches.length) return send(res, 200, { items: [] });

    const branchIds = branches.map((b) => b.id);
    const safes = await query(
      `SELECT s.id, s.name, s.branch_id,
              COALESCE((SELECT balance_after_halalas FROM cash_movements WHERE safe_id = s.id ORDER BY created_at DESC LIMIT 1),
                       s.opening_balance_halalas) AS current_balance_halalas
       FROM safes s WHERE s.branch_id = ANY($1::text[])`,
      [branchIds]
    );
    const byBranch = {};
    for (const s of safes) (byBranch[s.branch_id] = byBranch[s.branch_id] || []).push(s);

    send(res, 200, {
      items: branches.map((b) => ({ ...b, safes: byBranch[b.id] || [] })),
    });
  },
});
