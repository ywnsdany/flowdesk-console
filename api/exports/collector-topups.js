// Top-ups admin gave to collectors (from main treasury).
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const COLUMNS = [
  { key: 'created_at',     label: 'التاريخ',          format: (v) => formatRiyadhDateTime(v) },
  { key: 'collector_name', label: 'المحصّل' },
  { key: 'amount_halalas', label: 'المبلغ المشحون',    cls: 'num',
    format: (v) => `<span class="pos">+${SAR(v)}</span>` },
  { key: 'balance_after_halalas', label: 'الرصيد بعد', cls: 'num', format: SAR },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const collectorId = req.query.collector_id;
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    const where = ["cm.type = 'topup'", 'cm.created_at >= $1', 'cm.created_at <= $2',
                   'e.accountant_id = $3'];
    const args = [from, to, me.id];
    if (collectorId) { where.push(`cm.collector_id = $${args.length + 1}`); args.push(collectorId); }

    const rows = await query(
      `SELECT cm.id, cm.amount_halalas, cm.balance_after_halalas, cm.created_at,
              e.name AS collector_name, e.username AS collector_username
       FROM collector_movements cm
       JOIN employees e ON e.id = cm.collector_id
       WHERE ${where.join(' AND ')}
       ORDER BY cm.created_at DESC`,
      args
    );

    const totals = { amount_halalas: rows.reduce((s, r) => s + Number(r.amount_halalas), 0) };
    const stats = [
      { label: 'عدد عمليات الشحن', value: rows.length },
      { label: 'إجمالي المبلغ المشحون', value: SAR(totals.amount_halalas), cls: 'pos' },
    ];

    const collectorName = collectorId && rows.length ? rows[0].collector_name : 'كل المحصّلين';
    const filters = [`المحصّل: ${collectorName}`];

    const baseName = `topups_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title: 'تقرير شحن المحصّلين',
      period, filters, columns: COLUMNS, rows, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
