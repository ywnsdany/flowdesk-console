import { requireAccountant } from '../auth.js';
import { getDb } from '../db.js';
import { startOfDayRiyadh, endOfDayRiyadh } from '../date.js';
import { send } from '../router.js';

export function mountDashboard(router) {
  router.GET('/api/dashboard/stats', async (req, res) => {
    const me = requireAccountant(req);
    const todayStart = startOfDayRiyadh(Date.now());
    const todayEnd = endOfDayRiyadh(Date.now());
    const db = getDb();
    const pending = db.prepare(
      `SELECT COUNT(*) AS c FROM closings WHERE accountant_id = ? AND status = 'pending'`
    ).get(me.id).c;
    const todayCount = db.prepare(
      `SELECT COUNT(*) AS c FROM closings WHERE accountant_id = ? AND submitted_at >= ? AND submitted_at <= ?`
    ).get(me.id, todayStart, todayEnd).c;
    const todayTotal = db.prepare(
      `SELECT COALESCE(SUM(total_sales_halalas), 0) AS s FROM closings
       WHERE accountant_id = ? AND submitted_at >= ? AND submitted_at <= ? AND status != 'rejected'`
    ).get(me.id, todayStart, todayEnd).s;
    send(res, 200, {
      pending_count: pending,
      today_count: todayCount,
      today_total_halalas: todayTotal,
    });
  });
}
