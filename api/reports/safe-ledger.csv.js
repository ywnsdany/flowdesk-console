import { requireAccountant } from '../_lib/auth.js';
import { one, query } from '../_lib/db.js';
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
    const safeId = req.query.safe;
    if (!safeId) throw { status: 400, message: 'safe is required' };
    const safe = await one(
      'SELECT id, name FROM safes WHERE id = $1 AND accountant_id = $2',
      [safeId, me.id]
    );
    if (!safe) throw { status: 404, message: 'safe not found' };
    const from = req.query.from ? parseRiyadhDate(req.query.from) : 0;
    const to = req.query.to ? parseRiyadhDate(req.query.to) + 24 * 3600 * 1000 - 1 : Date.now();
    const rows = await query(
      `SELECT type, ref_id, amount_halalas, balance_after_halalas, created_at
       FROM cash_movements WHERE safe_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at`,
      [safeId, from, to]
    );

    let csv = BOM + row(['التاريخ', 'النوع', 'المرجع', 'المبلغ', 'الرصيد بعد']);
    const TYPE = { closing_confirm: 'تقفيل', deposit: 'إيداع بنك', opening: 'افتتاحي', adjustment: 'تعديل' };
    for (const r of rows) {
      csv += row([
        formatRiyadhDateTime(r.created_at),
        TYPE[r.type] || r.type,
        r.ref_id || '',
        (Number(r.amount_halalas) / 100).toFixed(2),
        (Number(r.balance_after_halalas) / 100).toFixed(2),
      ]);
    }
    send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ledger_${safe.name.replace(/\s+/g, '_')}_${toRiyadhDate(from)}_${toRiyadhDate(to)}.csv"`,
    });
  },
});
