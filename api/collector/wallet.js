// Collector wallet: balance + ledger.
import { requireCollector } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireCollector(req);
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const last = await one(
      `SELECT balance_after_halalas FROM collector_movements
       WHERE collector_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [me.id]
    );
    const balance = last ? Number(last.balance_after_halalas) : 0;

    const items = await query(
      `SELECT id, type, ref_id, amount_halalas, balance_after_halalas, created_at
       FROM collector_movements
       WHERE collector_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [me.id, limit]
    );

    // Aggregates from ledger.
    const totals = await one(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'collection' THEN amount_halalas ELSE 0 END), 0)::bigint AS collected_total,
         COALESCE(SUM(CASE WHEN type = 'expense'    THEN -amount_halalas ELSE 0 END), 0)::bigint AS expense_total,
         COALESCE(SUM(CASE WHEN type = 'purchase'   THEN -amount_halalas ELSE 0 END), 0)::bigint AS purchase_total,
         COALESCE(SUM(CASE WHEN type = 'transfer'   THEN -amount_halalas ELSE 0 END), 0)::bigint AS transfer_total
       FROM collector_movements WHERE collector_id = $1`,
      [me.id]
    );

    // Pending transfer requests (amount the collector is asking admin to confirm).
    const pending = await one(
      `SELECT COALESCE(SUM(amount_halalas), 0)::bigint AS amt,
              COUNT(*)::int AS n
       FROM collector_transfers WHERE collector_id = $1 AND status = 'pending'`,
      [me.id]
    );

    send(res, 200, {
      balance_halalas: balance,
      collected_total_halalas: Number(totals.collected_total),
      expense_total_halalas:   Number(totals.expense_total),
      purchase_total_halalas:  Number(totals.purchase_total),
      transfer_total_halalas:  Number(totals.transfer_total),
      pending_transfer_halalas: Number(pending.amt),
      pending_transfer_count:   pending.n,
      ledger: items,
    });
  },
});
