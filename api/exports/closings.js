// Closings report — full details, optional date/branch/status filter.
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const STATUS = { pending: 'بانتظار', confirmed: 'مؤكد', rejected: 'مرفوض' };

const COLUMNS = [
  { key: 'submitted_at',          label: 'تاريخ التقديم',  format: (v) => formatRiyadhDateTime(v) },
  { key: 'brand_branch',          label: 'البراند / الفرع' },
  { key: 'safe_name',             label: 'الخزنة' },
  { key: 'employee_name',         label: 'الموظف' },
  { key: 'total_sales_halalas',   label: 'إجمالي المبيعات', cls: 'num', format: SAR },
  { key: 'network_sales_halalas', label: 'الشبكة',          cls: 'num', format: SAR },
  { key: 'apps_sales_halalas',    label: 'التطبيقات',       cls: 'num', format: SAR },
  { key: 'cash_sales_halalas',    label: 'كاش الشفت',       cls: 'num', format: SAR },
  { key: 'cash_in_safe_halalas',  label: 'بالخزنة',         cls: 'num', format: SAR },
  { key: 'variance_halalas',      label: 'الفرق',           cls: 'num', format: (v) => {
      const n = Number(v); const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
      return `<span class="${cls}">${SAR(n)}</span>`;
    } },
  { key: 'status_label',          label: 'الحالة',          format: (v, row) =>
      `<span class="pill ${row.status}">${v}</span>` },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const branchId = req.query.branch_id;
    const status = req.query.status;
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    const where = ['c.accountant_id = $1', 'c.submitted_at >= $2', 'c.submitted_at <= $3'];
    const args = [me.id, from, to];
    if (branchId) { where.push(`c.branch_id = $${args.length + 1}`); args.push(branchId); }
    if (status)   { where.push(`c.status = $${args.length + 1}`);    args.push(status); }

    const rows = await query(
      `SELECT c.id, c.status, c.submitted_at,
              br.name AS brand_name, b.name AS branch_name,
              s.name AS safe_name, e.name AS employee_name,
              c.total_sales_halalas, c.network_sales_halalas, c.apps_sales_halalas,
              c.cash_sales_halalas, c.cash_in_safe_halalas, c.variance_halalas
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.submitted_at DESC`,
      args
    );

    const enriched = rows.map((r) => ({
      ...r,
      brand_branch: `${r.brand_name} / ${r.branch_name}`,
      status_label: STATUS[r.status] || r.status,
    }));

    const totals = enriched.reduce((acc, r) => {
      acc.total_sales_halalas   += Number(r.total_sales_halalas);
      acc.network_sales_halalas += Number(r.network_sales_halalas);
      acc.apps_sales_halalas    += Number(r.apps_sales_halalas);
      acc.cash_sales_halalas    += Number(r.cash_sales_halalas);
      acc.cash_in_safe_halalas  += Number(r.cash_in_safe_halalas);
      acc.variance_halalas      += Number(r.variance_halalas);
      return acc;
    }, { total_sales_halalas: 0, network_sales_halalas: 0, apps_sales_halalas: 0,
         cash_sales_halalas: 0, cash_in_safe_halalas: 0, variance_halalas: 0 });

    const stats = [
      { label: 'عدد التقفيلات', value: enriched.length },
      { label: 'إجمالي المبيعات', value: SAR(totals.total_sales_halalas) },
      { label: 'كاش الشفت',     value: SAR(totals.cash_sales_halalas) },
      { label: 'إجمالي الفرق',  value: SAR(totals.variance_halalas),
        cls: totals.variance_halalas > 0 ? 'pos' : totals.variance_halalas < 0 ? 'neg' : 'zero' },
    ];

    const filters = [
      branchId ? `الفرع: ${enriched[0]?.brand_branch || branchId}` : null,
      status ? `الحالة: ${STATUS[status] || status}` : null,
    ];

    const baseName = `closings_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title: 'تقرير التقفيلات',
      period, filters, columns: COLUMNS, rows: enriched, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
