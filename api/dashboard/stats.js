// Rich dashboard: today's totals, pending counts, main treasury, collectors, recent activity.
import { requireAccountant } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
import { startOfDayRiyadh, endOfDayRiyadh } from '../_lib/date.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const todayStart = startOfDayRiyadh(Date.now());
    const todayEnd = endOfDayRiyadh(Date.now());

    // Today
    const pending = await one(
      `SELECT COUNT(*)::int AS c FROM closings WHERE accountant_id = $1 AND status = 'pending'`,
      [me.id]
    );
    const todayClosings = await one(
      `SELECT COUNT(*)::int AS c FROM closings
       WHERE accountant_id = $1 AND submitted_at >= $2 AND submitted_at <= $3`,
      [me.id, todayStart, todayEnd]
    );
    const todayTotal = await one(
      `SELECT COALESCE(SUM(total_sales_halalas), 0)::bigint AS s FROM closings
       WHERE accountant_id = $1 AND submitted_at >= $2 AND submitted_at <= $3 AND status != 'rejected'`,
      [me.id, todayStart, todayEnd]
    );

    // Pending transfers
    const pendingTransfers = await one(
      `SELECT COUNT(*)::int AS c, COALESCE(SUM(amount_halalas), 0)::bigint AS s
       FROM collector_transfers WHERE accountant_id = $1 AND status = 'pending'`,
      [me.id]
    );

    // Main treasury balance
    const mainSafe = await one(
      'SELECT id, opening_balance_halalas FROM safes WHERE accountant_id = $1 AND is_main = TRUE LIMIT 1',
      [me.id]
    );
    let mainBalance = 0;
    if (mainSafe) {
      const lastMove = await one(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [mainSafe.id]
      );
      mainBalance = lastMove
        ? Number(lastMove.balance_after_halalas)
        : Number(mainSafe.opening_balance_halalas);
    }

    // Counts for entities
    const counts = await one(
      `SELECT
         (SELECT COUNT(*)::int FROM brands     WHERE accountant_id = $1) AS brands,
         (SELECT COUNT(*)::int FROM branches   WHERE accountant_id = $1) AS branches,
         (SELECT COUNT(*)::int FROM safes      WHERE accountant_id = $1) AS safes,
         (SELECT COUNT(*)::int FROM employees  WHERE accountant_id = $1 AND status = 'active') AS employees`,
      [me.id]
    );

    // Collectors with wallet balance
    const collectors = await query(
      `SELECT e.id, e.name, e.username,
              COALESCE(
                (SELECT balance_after_halalas FROM collector_movements
                 WHERE collector_id = e.id ORDER BY created_at DESC LIMIT 1),
                0
              )::bigint AS wallet_balance_halalas
       FROM employees e
       WHERE e.accountant_id = $1 AND e.role = 'collector' AND e.status = 'active'
       ORDER BY e.name`,
      [me.id]
    );

    // Recent activity (last 10 events across all types)
    const recent = [];

    const closings = await query(
      `SELECT c.id, c.submitted_at, c.total_sales_halalas, c.status,
              br.name AS brand_name, b.name AS branch_name, e.name AS employee_name
       FROM closings c
       JOIN branches b  ON b.id = c.branch_id
       JOIN brands   br ON br.id = b.brand_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.accountant_id = $1
       ORDER BY c.submitted_at DESC LIMIT 5`,
      [me.id]
    );
    for (const c of closings) {
      recent.push({
        type: 'closing',
        time: Number(c.submitted_at),
        title: `${c.brand_name} / ${c.branch_name}`,
        sub: c.employee_name || '—',
        amount: Number(c.total_sales_halalas),
        status: c.status,
      });
    }

    const topups = await query(
      `SELECT cm.amount_halalas, cm.created_at, e.name AS collector_name
       FROM collector_movements cm
       JOIN employees e ON e.id = cm.collector_id
       WHERE e.accountant_id = $1 AND cm.type = 'topup'
       ORDER BY cm.created_at DESC LIMIT 3`,
      [me.id]
    );
    for (const t of topups) {
      recent.push({
        type: 'topup',
        time: Number(t.created_at),
        title: 'شحن محصّل',
        sub: t.collector_name,
        amount: Number(t.amount_halalas),
      });
    }

    const purchases = await query(
      `SELECT ce.amount_halalas, ce.kind, ce.place, ce.reason, ce.spent_at,
              e.name AS collector_name
       FROM collector_expenses ce
       JOIN employees e ON e.id = ce.collector_id
       WHERE ce.accountant_id = $1
       ORDER BY ce.spent_at DESC LIMIT 3`,
      [me.id]
    );
    for (const p of purchases) {
      recent.push({
        type: p.kind === 'purchase' ? 'purchase' : 'expense',
        time: Number(p.spent_at),
        title: p.kind === 'purchase' ? 'مشتريات' : 'مصروف',
        sub: `${p.collector_name} — ${p.place || p.reason || ''}`.slice(0, 60),
        amount: Number(p.amount_halalas),
      });
    }

    recent.sort((a, b) => b.time - a.time);

    send(res, 200, {
      // Today
      pending_count: pending.c,
      today_count: todayClosings.c,
      today_total_halalas: Number(todayTotal.s),
      // Pending
      pending_transfers_count: pendingTransfers.c,
      pending_transfers_amount_halalas: Number(pendingTransfers.s),
      // Main treasury
      main_safe_balance_halalas: mainBalance,
      // Counts
      brands_count: counts.brands,
      branches_count: counts.branches,
      safes_count: counts.safes,
      employees_count: counts.employees,
      // Collectors
      collectors,
      // Recent activity
      recent: recent.slice(0, 10),
    });
  },
});
