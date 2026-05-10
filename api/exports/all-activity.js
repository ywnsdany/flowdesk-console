// Unified activity timeline — every money-related event in one chronological view.
import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const COLUMNS = [
  { key: 'time',       label: 'التاريخ',  format: (v) => formatRiyadhDateTime(v) },
  { key: 'type_label', label: 'النوع',     format: (v, row) =>
      `<span class="pill ${row.dir === 'in' ? 'in' : 'out'}">${v}</span>` },
  { key: 'where',      label: 'المكان' },
  { key: 'who',        label: 'من / إلى' },
  { key: 'detail',     label: 'تفاصيل' },
  { key: 'amount',     label: 'المبلغ', cls: 'num', format: (v, row) => {
      const sign = row.dir === 'in' ? '+' : '−';
      const cls  = row.dir === 'in' ? 'pos' : 'neg';
      return `<span class="${cls}">${sign}${SAR(v)}</span>`;
    } },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    const events = [];

    // 1) Confirmed closings
    const closings = await query(
      `SELECT c.id, c.submitted_at, c.cash_in_safe_halalas, c.cash_sales_halalas,
              br.name AS brand_name, b.name AS branch_name,
              s.name AS safe_name, e.name AS employee_name
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands   br ON br.id = b.brand_id
       JOIN safes    s  ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.accountant_id = $1 AND c.status = 'confirmed'
         AND c.submitted_at >= $2 AND c.submitted_at <= $3`,
      [me.id, from, to]
    );
    for (const c of closings) {
      events.push({
        time: Number(c.submitted_at),
        type_label: '☑ تقفيل',
        dir: 'in',
        where: `${c.brand_name} / ${c.branch_name} / ${c.safe_name}`,
        who: c.employee_name || '—',
        detail: `كاش الشفت ${SAR(c.cash_sales_halalas)}`,
        amount: c.cash_in_safe_halalas,
      });
    }

    // 2) Bank deposits
    const deposits = await query(
      `SELECT d.id, d.amount_halalas, d.deposit_date, d.note,
              s.name AS safe_name, b.name AS branch_name, br.name AS brand_name
       FROM bank_deposits d
       JOIN safes s ON s.id = d.safe_id
       LEFT JOIN branches b  ON b.id = s.branch_id
       LEFT JOIN brands   br ON br.id = b.brand_id
       WHERE d.accountant_id = $1
         AND d.deposit_date >= $2 AND d.deposit_date <= $3`,
      [me.id, from, to]
    );
    for (const d of deposits) {
      events.push({
        time: Number(d.deposit_date),
        type_label: '↓ إيداع بنك',
        dir: 'out',
        where: d.brand_name ? `${d.brand_name} / ${d.branch_name} / ${d.safe_name}` : `★ ${d.safe_name}`,
        who: 'البنك',
        detail: d.note || '—',
        amount: d.amount_halalas,
      });
    }

    // 3) Top-ups to collectors (from main treasury)
    const topups = await query(
      `SELECT cm.id, cm.amount_halalas, cm.created_at,
              e.name AS collector_name
       FROM collector_movements cm
       JOIN employees e ON e.id = cm.collector_id
       WHERE cm.type = 'topup' AND e.accountant_id = $1
         AND cm.created_at >= $2 AND cm.created_at <= $3`,
      [me.id, from, to]
    );
    for (const t of topups) {
      events.push({
        time: Number(t.created_at),
        type_label: '💰 شحن محصّل',
        dir: 'out',
        where: '★ الخزنة الرئيسية',
        who: t.collector_name,
        detail: 'تمويل محفظة',
        amount: t.amount_halalas,
      });
    }

    // 4) Collector purchases & expenses
    const purchases = await query(
      `SELECT ce.amount_halalas, ce.kind, ce.category, ce.place, ce.reason, ce.spent_at,
              e.name AS collector_name
       FROM collector_expenses ce
       JOIN employees e ON e.id = ce.collector_id
       WHERE ce.accountant_id = $1
         AND ce.spent_at >= $2 AND ce.spent_at <= $3`,
      [me.id, from, to]
    );
    for (const p of purchases) {
      events.push({
        time: Number(p.spent_at),
        type_label: p.kind === 'purchase' ? '🛒 مشتريات' : '⬆ مصروف',
        dir: 'out',
        where: `محفظة ${p.collector_name}`,
        who: p.place || '—',
        detail: p.reason || '—',
        amount: p.amount_halalas,
      });
    }

    // 5) Confirmed transfers (collector → main treasury)
    const transfers = await query(
      `SELECT t.amount_halalas, t.submitted_at, t.note,
              e.name AS collector_name, s.name AS safe_name
       FROM collector_transfers t
       JOIN employees e ON e.id = t.collector_id
       JOIN safes s     ON s.id = t.main_safe_id
       WHERE t.accountant_id = $1 AND t.status = 'confirmed'
         AND t.submitted_at >= $2 AND t.submitted_at <= $3`,
      [me.id, from, to]
    );
    for (const t of transfers) {
      events.push({
        time: Number(t.submitted_at),
        type_label: '↗ تسليم محصّل',
        dir: 'in',
        where: `★ ${t.safe_name}`,
        who: t.collector_name,
        detail: t.note || '—',
        amount: t.amount_halalas,
      });
    }

    // Sort newest first
    events.sort((a, b) => b.time - a.time);

    const totalIn  = events.filter((e) => e.dir === 'in')
      .reduce((s, e) => s + Number(e.amount), 0);
    const totalOut = events.filter((e) => e.dir === 'out')
      .reduce((s, e) => s + Number(e.amount), 0);

    const stats = [
      { label: 'عدد العمليات', value: events.length },
      { label: 'وارد',         value: SAR(totalIn),  cls: 'pos' },
      { label: 'صادر',         value: SAR(totalOut), cls: 'neg' },
      { label: 'الصافي',       value: SAR(totalIn - totalOut),
        cls: totalIn - totalOut > 0 ? 'pos' : totalIn - totalOut < 0 ? 'neg' : 'zero' },
    ];

    const totals = { amount: totalIn - totalOut };

    const baseName = `all-activity_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title: 'كشف حساب شامل — كل العمليات',
      period, columns: COLUMNS, rows: events, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
