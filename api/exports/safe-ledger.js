// Safe ledger — every cash movement on one safe (or all safes if not specified).
import { requireAccountant } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';
import {
  renderHtml, renderExcel, parseDateRange, exportHeaders,
  SAR, formatRiyadhDateTime,
} from '../_lib/render-report.js';

const TYPE_LABEL = {
  opening:         'افتتاحي',
  closing_confirm: 'تقفيل (تأكيد)',
  closing_route:   'تقفيل (تحويل)',
  deposit:         'إيداع بنك',
  collection:      'تجميع',
  transfer:        'تحويل',
  topup_employee:  'شحن موظف',
  adjustment:      'تعديل',
};

const COLUMNS = [
  { key: 'created_at',            label: 'التاريخ',         format: (v) => formatRiyadhDateTime(v) },
  { key: 'safe_label',            label: 'الخزنة' },
  { key: 'type_label',            label: 'النوع' },
  { key: 'ref_id',                label: 'المرجع',          format: (v) => v ? `<code style="font-family:monospace;font-size:10px">${v.slice(0, 8)}…</code>` : '—' },
  { key: 'amount_halalas',        label: 'المبلغ',          cls: 'num', format: (v) => {
      const n = Number(v);
      const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
      const sign = n > 0 ? '+' : '';
      return `<span class="${cls}">${sign}${SAR(n)}</span>`;
    } },
  { key: 'balance_after_halalas', label: 'الرصيد بعد',      cls: 'num', format: SAR },
];

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const { from, to, period } = parseDateRange(req);
    const safeId = req.query.safe_id;
    const onlyMain = req.query.main === '1';
    const format = req.query.format === 'excel' ? 'excel' : 'html';

    let safesFilter = 'safes.accountant_id = $1';
    const args = [me.id, from, to];
    if (safeId) { safesFilter += ` AND safes.id = $${args.length + 1}`; args.push(safeId); }
    else if (onlyMain) { safesFilter += ` AND safes.is_main = TRUE`; }

    const rows = await query(
      `SELECT cm.id, cm.safe_id, cm.type, cm.ref_id, cm.amount_halalas,
              cm.balance_after_halalas, cm.created_at,
              safes.name AS safe_name, safes.is_main,
              br.name AS brand_name, b.name AS branch_name
       FROM cash_movements cm
       JOIN safes ON safes.id = cm.safe_id
       LEFT JOIN branches b  ON b.id = safes.branch_id
       LEFT JOIN brands   br ON br.id = b.brand_id
       WHERE ${safesFilter}
         AND cm.created_at >= $2
         AND cm.created_at <= $3
       ORDER BY cm.created_at DESC`,
      args
    );

    const enriched = rows.map((r) => ({
      ...r,
      safe_label: r.is_main
        ? `★ ${r.safe_name}`
        : `${r.brand_name || ''} / ${r.branch_name || ''} / ${r.safe_name}`,
      type_label: TYPE_LABEL[r.type] || r.type,
    }));

    const totals = {
      amount_halalas: enriched.reduce((s, r) => s + Number(r.amount_halalas), 0),
    };

    let title = 'دفتر الخزائن';
    if (safeId) {
      const safe = await one('SELECT name FROM safes WHERE id = $1', [safeId]);
      title = `دفتر خزنة — ${safe?.name || ''}`;
    } else if (onlyMain) {
      title = 'دفتر الخزنة الرئيسية';
    }

    const incoming = enriched.filter((r) => Number(r.amount_halalas) > 0)
      .reduce((s, r) => s + Number(r.amount_halalas), 0);
    const outgoing = enriched.filter((r) => Number(r.amount_halalas) < 0)
      .reduce((s, r) => s + Math.abs(Number(r.amount_halalas)), 0);

    const stats = [
      { label: 'عدد الحركات',  value: enriched.length },
      { label: 'وارد',         value: SAR(incoming), cls: 'pos' },
      { label: 'صادر',         value: SAR(outgoing), cls: 'neg' },
      { label: 'صافي',         value: SAR(totals.amount_halalas),
        cls: totals.amount_halalas > 0 ? 'pos' : totals.amount_halalas < 0 ? 'neg' : 'zero' },
    ];

    const baseName = `safe-ledger_${period.replace(/[\s→]/g, '_')}`;
    const renderer = format === 'excel' ? renderExcel : renderHtml;
    const html = renderer({
      title, period, columns: COLUMNS, rows: enriched, totals, stats,
      autoprint: format !== 'excel',
    });
    send(res, 200, html, exportHeaders(format, baseName));
  },
});
