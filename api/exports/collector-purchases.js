// Collector purchases & expenses report (every spend Faisal made).
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const CAT_LABEL = {
  fuel: '⛽ بنزين', food: '🍱 طعام', maintenance: '🔧 صيانة',
  transport: '🚗 مواصلات', supplies: '📦 مستلزمات',
  equipment: '🔌 معدات', inventory: '🍽 بضاعة',
  transfer_to_admin: '📤 تحويل', other: '📌 أخرى',
};

const COLUMNS = [
  { key: 'spent_at',       label: 'التاريخ',     format: (v) => formatRiyadhDateTime(v) },
  { key: 'collector_name', label: 'المحصّل' },
  { key: 'kind_label',     label: 'النوع' },
  { key: 'category_label', label: 'التصنيف' },
  { key: 'place',          label: 'المكان' },
  { key: 'reason',         label: 'السبب / ماذا' },
  { key: 'amount_halalas', label: 'المبلغ', cls: 'num', format: SAR },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const collectorId = req.query.collector_id;
    const kind = req.query.kind; // 'expense' | 'purchase' | undefined
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    const where = ['ce.accountant_id = $1', 'ce.spent_at >= $2', 'ce.spent_at <= $3'];
    const args = [me.id, from, to];
    if (collectorId) { where.push(`ce.collector_id = $${args.length + 1}`); args.push(collectorId); }
    if (kind === 'expense' || kind === 'purchase') {
      where.push(`ce.kind = $${args.length + 1}`); args.push(kind);
    }

    const rows = await query(
      `SELECT ce.id, ce.amount_halalas, ce.category, ce.place, ce.reason,
              ce.kind, ce.spent_at,
              e.name AS collector_name, e.username AS collector_username
       FROM collector_expenses ce
       JOIN employees e ON e.id = ce.collector_id
       WHERE ${where.join(' AND ')}
       ORDER BY ce.spent_at DESC`,
      args
    );

    const enriched = rows.map((r) => ({
      ...r,
      kind_label: r.kind === 'purchase' ? '🛒 مشتريات' : '⬆ مصروف',
      category_label: CAT_LABEL[r.category] || r.category,
    }));

    const totals = { amount_halalas: enriched.reduce((s, r) => s + Number(r.amount_halalas), 0) };
    const purchasesTotal = enriched.filter((r) => r.kind === 'purchase')
      .reduce((s, r) => s + Number(r.amount_halalas), 0);
    const expensesTotal = enriched.filter((r) => r.kind === 'expense')
      .reduce((s, r) => s + Number(r.amount_halalas), 0);

    const stats = [
      { label: 'عدد العمليات', value: enriched.length },
      { label: 'المشتريات', value: SAR(purchasesTotal) },
      { label: 'المصاريف',  value: SAR(expensesTotal) },
      { label: 'الإجمالي',   value: SAR(totals.amount_halalas) },
    ];

    const collectorName = collectorId && enriched.length ? enriched[0].collector_name : 'كل المحصّلين';
    const filters = [
      `المحصّل: ${collectorName}`,
      kind === 'purchase' ? 'النوع: مشتريات فقط' :
      kind === 'expense'  ? 'النوع: مصاريف فقط' : null,
    ];

    const baseName = `purchases_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title: kind === 'purchase' ? 'تقرير المشتريات'
            : kind === 'expense' ? 'تقرير المصاريف'
            : 'تقرير المشتريات والمصاريف',
      period, filters, columns: COLUMNS, rows: enriched, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
