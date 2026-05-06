import { requireAccountant } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { startOfDayRiyadh, endOfDayRiyadh } from '../_lib/date.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const todayStart = startOfDayRiyadh(Date.now());
    const todayEnd = endOfDayRiyadh(Date.now());
    const r1 = await one(
      `SELECT COUNT(*)::int AS c FROM closings WHERE accountant_id = $1 AND status = 'pending'`,
      [me.id]
    );
    const r2 = await one(
      `SELECT COUNT(*)::int AS c FROM closings WHERE accountant_id = $1 AND submitted_at >= $2 AND submitted_at <= $3`,
      [me.id, todayStart, todayEnd]
    );
    const r3 = await one(
      `SELECT COALESCE(SUM(total_sales_halalas), 0)::bigint AS s FROM closings
       WHERE accountant_id = $1 AND submitted_at >= $2 AND submitted_at <= $3 AND status != 'rejected'`,
      [me.id, todayStart, todayEnd]
    );
    send(res, 200, {
      pending_count: r1.c,
      today_count: r2.c,
      today_total_halalas: Number(r3.s),
    });
  },
});
