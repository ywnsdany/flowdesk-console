import { requireAccountant } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { parseRiyadhDate, formatRiyadhDateTime, toRiyadhDate } from '../_lib/date.js';
import { handler, send } from '../_lib/http.js';

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function row(arr) { return arr.map(csvEscape).join(',') + '\n'; }
const BOM = '﻿';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const from = req.query.from ? parseRiyadhDate(req.query.from) : 0;
    const to = req.query.to ? parseRiyadhDate(req.query.to) + 24 * 3600 * 1000 - 1 : Date.now();
    const branchId = req.query.branch_id;
    const where = ['c.accountant_id = $1', 'c.submitted_at >= $2', 'c.submitted_at <= $3'];
    const args = [me.id, from, to];
    if (branchId) { where.push(`c.branch_id = $${args.length + 1}`); args.push(branchId); }
    const rows = await query(
      `SELECT c.id, c.status, c.submitted_at, c.reviewed_at,
              br.name AS brand, b.name AS branch, s.name AS safe, e.name AS employee,
              c.total_sales_halalas, c.network_sales_halalas, c.apps_sales_halalas, c.apps_invoice_count,
              c.cash_sales_halalas, c.opening_balance_halalas, c.expected_cash_halalas, c.cash_in_safe_halalas,
              c.variance_halalas, c.custody_in_hand_halalas, c.custody_expense_halalas, c.custody_expense_note,
              c.notes, c.reject_reason
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.submitted_at`,
      args
    );

    let csv = BOM + row([
      'تاريخ التقديم', 'تاريخ المراجعة', 'البراند', 'الفرع', 'الخزنة', 'الموظف',
      'إجمالي المبيعات', 'الشبكة', 'التطبيقات', 'عدد فواتير التطبيقات', 'كاش الشفت',
      'افتتاحي الخزنة', 'المتوقع', 'الفعلي', 'الفرق',
      'كاش العهدة', 'مصاريف العهدة', 'ملاحظة العهدة', 'ملاحظات', 'الحالة', 'سبب الرفض',
    ]);
    const f = (h) => (Number(h) / 100).toFixed(2);
    for (const r of rows) {
      csv += row([
        formatRiyadhDateTime(r.submitted_at), formatRiyadhDateTime(r.reviewed_at),
        r.brand, r.branch, r.safe, r.employee || '',
        f(r.total_sales_halalas), f(r.network_sales_halalas), f(r.apps_sales_halalas), r.apps_invoice_count,
        f(r.cash_sales_halalas), f(r.opening_balance_halalas), f(r.expected_cash_halalas), f(r.cash_in_safe_halalas), f(r.variance_halalas),
        f(r.custody_in_hand_halalas), f(r.custody_expense_halalas), r.custody_expense_note || '',
        r.notes || '',
        ({ pending: 'بانتظار', confirmed: 'مؤكد', rejected: 'مرفوض' })[r.status] || r.status,
        r.reject_reason || '',
      ]);
    }
    send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="closings_${toRiyadhDate(from)}_${toRiyadhDate(to)}.csv"`,
    });
  },
});
