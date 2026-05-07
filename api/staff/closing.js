// Authenticated employee submits a daily closing for a chosen date.
// Date must be within the last 7 days.

import { requireEmployee, requireCsrf } from '../_lib/auth.js';
import { one, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { computeClosing } from '../_lib/money.js';
import { startOfDayRiyadh } from '../_lib/date.js';
import { handler, readJson, send } from '../_lib/http.js';

const ALLOWED_KINDS = new Set([
  'foodics_invoice', 'network', 'apps', 'cash', 'custody_receipt', 'other',
  'app_keeta', 'app_hungerstation', 'app_jahez', 'app_ninja',
]);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function parseClosingDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw { status: 400, message: 'تاريخ غير صالح (YYYY-MM-DD)' };
  }
  const ms = new Date(s + 'T00:00:00.000Z').getTime() - 3 * 60 * 60 * 1000; // to Riyadh start-of-day
  return ms;
}

export default handler({
  POST: async (req, res) => {
    const me = requireEmployee(req);
    requireCsrf(req, me);
    const body = await readJson(req);

    const branchId = String(body.branch_id || '');
    const safeId = String(body.safe_id || '');
    if (!branchId || !safeId) throw { status: 400, message: 'الفرع والخزنة مطلوبين' };

    // 1. Verify employee is allowed to submit for this branch.
    const allowed = await one(
      'SELECT 1 AS ok FROM user_branches WHERE employee_id = $1 AND branch_id = $2',
      [me.id, branchId]
    );
    if (!allowed) throw { status: 403, message: 'غير مصرّح لك بهذا الفرع' };

    // 2. Verify the safe is in that branch and shares the same admin owner.
    const safe = await one(
      `SELECT s.id, s.branch_id, s.accountant_id, s.opening_balance_halalas
       FROM safes s WHERE s.id = $1`,
      [safeId]
    );
    if (!safe || safe.branch_id !== branchId || safe.accountant_id !== me.owner) {
      throw { status: 400, message: 'الخزنة لا تنتمي للفرع المحدد' };
    }

    // 3. Date must be within last 7 days.
    const closingDate = parseClosingDate(body.closing_date);
    const todayStart = startOfDayRiyadh(Date.now());
    if (closingDate > todayStart) throw { status: 400, message: 'لا يمكن تسجيل تقفيل لتاريخ مستقبلي' };
    if (todayStart - closingDate > SEVEN_DAYS_MS) {
      throw { status: 400, message: 'التاريخ خارج نطاق آخر ٧ أيام' };
    }

    // 4. Last cash balance for this safe.
    const lastMove = await one(
      'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
      [safe.id]
    );
    const opening = lastMove ? Number(lastMove.balance_after_halalas) : Number(safe.opening_balance_halalas);

    // 5. Branch settings → required photos.
    const settings = (await one('SELECT * FROM branch_settings WHERE branch_id = $1', [branchId])) || {
      enable_apps_sales: 1,
      require_foodics_img: 1, require_network_img: 1, require_apps_img: 1,
      require_cash_img: 1, require_custody_receipt_img: 1,
    };

    const computed = computeClosing(body, opening, !!settings.enable_apps_sales);

    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const haveKinds = new Set(attachments.map((a) => a.kind));
    const missing = [];
    if (settings.require_foodics_img && !haveKinds.has('foodics_invoice')) missing.push('صورة فاتورة فودكس');
    if (settings.require_network_img && !haveKinds.has('network')) missing.push('صورة جهاز الشبكة');
    if (settings.require_cash_img && !haveKinds.has('cash')) missing.push('صورة الكاش');
    if (settings.require_custody_receipt_img && computed.custody_expense_halalas > 0 && !haveKinds.has('custody_receipt')) {
      missing.push('إيصال مصاريف العهدة');
    }
    if (missing.length) throw { status: 400, message: `صور ناقصة: ${missing.join('، ')}` };

    const closingId = newId();
    const submittedAt = Date.now();
    const appsInvoiceCount = Math.max(0, parseInt(body.apps_invoice_count || 0, 10));
    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;
    const slice500 = (v) => v ? String(v).slice(0, 500) : null;

    await tx(async (q) => {
      await q(
        `INSERT INTO closings (
           id, link_id, accountant_id, branch_id, safe_id, employee_id,
           total_sales_halalas, network_sales_halalas, apps_sales_halalas, apps_invoice_count, cash_sales_halalas,
           keeta_halalas, hungerstation_halalas, jahez_halalas, ninja_halalas,
           keeta_note, hungerstation_note, jahez_note, ninja_note,
           cash_in_safe_halalas, custody_in_hand_halalas, custody_expense_halalas, custody_expense_note,
           opening_balance_halalas, expected_cash_halalas, variance_halalas,
           notes, status, submitted_at, closing_date
         ) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'pending',$27,$28)`,
        [
          closingId, me.owner, branchId, safe.id, me.id,
          computed.total_sales_halalas, computed.network_sales_halalas, computed.apps_sales_halalas, appsInvoiceCount, computed.cash_sales_halalas,
          computed.keeta_halalas, computed.hungerstation_halalas, computed.jahez_halalas, computed.ninja_halalas,
          slice500(body.keeta_note), slice500(body.hungerstation_note), slice500(body.jahez_note), slice500(body.ninja_note),
          computed.cash_in_safe_halalas, computed.custody_in_hand_halalas, computed.custody_expense_halalas, slice500(body.custody_expense_note),
          computed.opening_balance_halalas, computed.expected_cash_halalas, computed.variance_halalas,
          notes, submittedAt, closingDate,
        ]
      );

      for (const a of attachments) {
        if (!ALLOWED_KINDS.has(a.kind)) continue;
        if (typeof a.storage_key !== 'string' || !a.storage_key.startsWith(`pending/emp_${me.id}/`)) continue;
        await q(
          'INSERT INTO attachments (id, closing_id, kind, storage_key, mime, size, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [newId(), closingId, a.kind, a.storage_key, a.mime || 'application/octet-stream', a.size || 0, Date.now()]
        );
      }
    });

    send(res, 200, {
      ok: true,
      closing_id: closingId,
      result: {
        opening_balance_halalas: computed.opening_balance_halalas,
        cash_sales_halalas: computed.cash_sales_halalas,
        expected_cash_halalas: computed.expected_cash_halalas,
        cash_in_safe_halalas: computed.cash_in_safe_halalas,
        variance_halalas: computed.variance_halalas,
      },
    });
  },
});
