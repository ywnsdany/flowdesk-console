// Returns branches the logged-in employee can submit for, each with its safes + settings.
import { requireEmployee } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireEmployee(req);
    const rows = await query(
      `SELECT b.id, b.name, br.name AS brand_name
       FROM user_branches ub
       JOIN branches b ON b.id = ub.branch_id
       JOIN brands br ON br.id = b.brand_id
       WHERE ub.employee_id = $1
       ORDER BY br.name, b.name`,
      [me.id]
    );

    if (!rows.length) return send(res, 200, { items: [] });

    const branchIds = rows.map((r) => r.id);
    // Safes for these branches.
    const safes = await query(
      `SELECT s.id, s.name, s.branch_id,
              s.opening_balance_halalas,
              COALESCE((SELECT balance_after_halalas FROM cash_movements WHERE safe_id = s.id ORDER BY created_at DESC LIMIT 1),
                       s.opening_balance_halalas) AS current_balance_halalas
       FROM safes s
       WHERE s.branch_id = ANY($1::text[])`,
      [branchIds]
    );
    // Per-branch settings.
    const settings = await query(
      `SELECT * FROM branch_settings WHERE branch_id = ANY($1::text[])`,
      [branchIds]
    );

    const settingsByBranch = Object.fromEntries(settings.map((s) => [s.branch_id, s]));
    const safesByBranch = {};
    for (const s of safes) {
      (safesByBranch[s.branch_id] = safesByBranch[s.branch_id] || []).push(s);
    }

    const items = rows.map((b) => ({
      id: b.id, name: b.name, brand_name: b.brand_name,
      safes: safesByBranch[b.id] || [],
      settings: settingsByBranch[b.id] || {
        enable_apps_sales: 1,
        require_foodics_img: 1, require_network_img: 1, require_apps_img: 1,
        require_cash_img: 1, require_custody_receipt_img: 1,
      },
    }));
    send(res, 200, { items });
  },
});
