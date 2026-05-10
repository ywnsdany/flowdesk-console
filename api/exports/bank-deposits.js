// Bank deposits report — what went out of branch safes to banks.
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const COLUMNS = [
  { key: 'deposit_date',   label: 'تاريخ الإيداع', format: (v) => formatRiyadhDateTime(v) },
  { key: 'brand_branch',   label: 'البراند / الفرع' },
  { key: 'safe_name',      label: 'الخزنة' },
  { key: 'amount_halalas', label: 'المبلغ', cls: 'num', format: SAR },
  { key: 'note',           label: 'ملاحظة', format: (v) => v || '—' },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const safeId = req.query.safe_id;
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    const where = ['d.accountant_id = $1', 'd.deposit_date >= $2', 'd.deposit_date <= $3'];
    const args = [me.id, from, to];
    if (safeId) { where.push(`d.safe_id = $${args.length + 1}`); args.push(safeId); }

    const rows = await query(
      `SELECT d.id, d.amount_halalas, d.deposit_date, d.note, d.created_at,
              s.name AS safe_name, b.name AS branch_name, br.name AS brand_name
       FROM bank_deposits d
       JOIN safes s ON s.id = d.safe_id
       LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN brands   br ON br.id = b.brand_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.deposit_date DESC, d.created_at DESC`,
      args
    );

    const enriched = rows.map((r) => ({
      ...r,
      brand_branch: r.brand_name ? `${r.brand_name} / ${r.branch_name}` : '— الخزنة الرئيسية —',
    }));

    const totals = { amount_halalas: enriched.reduce((s, r) => s + Number(r.amount_halalas), 0) };
    const stats = [
      { label: 'عدد الإيداعات', value: enriched.length },
      { label: 'الإجمالي',       value: SAR(totals.amount_halalas) },
    ];

    const baseName = `bank-deposits_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title: 'تقرير الإيداعات البنكية',
      period, columns: COLUMNS, rows: enriched, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
