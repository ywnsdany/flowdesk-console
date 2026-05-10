// Collector-to-admin transfers (legacy, but report still useful for history).
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const STATUS = { pending: 'بانتظار', confirmed: 'مؤكد', rejected: 'مرفوض' };

const COLUMNS = [
  { key: 'submitted_at',     label: 'تاريخ الطلب',  format: (v) => formatRiyadhDateTime(v) },
  { key: 'collector_name',   label: 'المحصّل' },
  { key: 'safe_name',        label: 'إلى خزنة' },
  { key: 'amount_halalas',   label: 'المبلغ',       cls: 'num', format: SAR },
  { key: 'status_label',     label: 'الحالة',       format: (v, row) =>
      `<span class="pill ${row.status}">${v}</span>` },
  { key: 'reviewed_at',      label: 'تاريخ المراجعة', format: (v) => v ? formatRiyadhDateTime(v) : '—' },
  { key: 'note',             label: 'ملاحظة',       format: (v, row) =>
      v || (row.reject_reason ? `<span class="neg">رفض: ${row.reject_reason}</span>` : '—') },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const status = req.query.status;
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    const where = ['t.accountant_id = $1', 't.submitted_at >= $2', 't.submitted_at <= $3'];
    const args = [me.id, from, to];
    if (status) { where.push(`t.status = $${args.length + 1}`); args.push(status); }

    const rows = await query(
      `SELECT t.id, t.amount_halalas, t.note, t.status, t.reject_reason,
              t.submitted_at, t.reviewed_at,
              e.name AS collector_name, s.name AS safe_name
       FROM collector_transfers t
       JOIN employees e ON e.id = t.collector_id
       JOIN safes s ON s.id = t.main_safe_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.submitted_at DESC`,
      args
    );

    const enriched = rows.map((r) => ({ ...r, status_label: STATUS[r.status] || r.status }));
    const confirmed = enriched.filter((r) => r.status === 'confirmed');

    const totals = { amount_halalas: confirmed.reduce((s, r) => s + Number(r.amount_halalas), 0) };
    const stats = [
      { label: 'عدد التحويلات', value: enriched.length },
      { label: 'مؤكدة', value: confirmed.length },
      { label: 'قيد المراجعة', value: enriched.filter((r) => r.status === 'pending').length },
      { label: 'إجمالي المؤكد', value: SAR(totals.amount_halalas), cls: 'pos' },
    ];

    const baseName = `transfers_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title: 'تقرير تحويلات المحصّلين',
      period, filters: status ? [`الحالة: ${STATUS[status]}`] : [],
      columns: COLUMNS, rows: enriched, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
