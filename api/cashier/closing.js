import { verifyJwt } from '../_lib/auth.js';
import { one, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { computeClosing } from '../_lib/money.js';
import { handler, readJson, send } from '../_lib/http.js';

const ALLOWED_KINDS = new Set([
  'foodics_invoice', 'network', 'apps', 'cash', 'custody_receipt', 'other',
  'app_keeta', 'app_hungerstation', 'app_jahez', 'app_ninja',
]);

async function readScopedJwt(req, expectedLinkId) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) throw { status: 401, message: 'unauthorized' };
  const payload = verifyJwt(m[1]);
  if (!payload || payload.scope !== 'cashier' || payload.link_id !== expectedLinkId) {
    throw { status: 401, message: 'invalid session' };
  }
  const link = await one('SELECT pin_version, status FROM cashier_links WHERE id = $1', [payload.link_id]);
  if (!link || link.status !== 'active' || link.pin_version !== payload.pin_version) {
    throw { status: 401, message: 'session invalidated' };
  }
  return payload;
}

export default handler({
  POST: async (req, res) => {
    const linkId = String(req.query.l || '');
    if (!linkId) throw { status: 400, message: 'missing link' };
    await readScopedJwt(req, linkId);
    const body = await readJson(req);

    const link = await one(
      `SELECT l.id, l.accountant_id, l.branch_id, l.safe_id, l.employee_id, s.opening_balance_halalas
       FROM cashier_links l JOIN safes s ON s.id = l.safe_id
       WHERE l.id = $1`,
      [linkId]
    );
    if (!link) throw { status: 404, message: 'invalid link' };

    const lastMove = await one(
      'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
      [link.safe_id]
    );
    const opening = lastMove ? Number(lastMove.balance_after_halalas) : Number(link.opening_balance_halalas);

    const settings = (await one('SELECT * FROM branch_settings WHERE branch_id = $1', [link.branch_id])) || {
      enable_apps_sales: 1,
      require_foodics_img: 1, require_network_img: 1, require_apps_img: 1, require_cash_img: 1, require_custody_receipt_img: 1,
    };

    const computed = computeClosing(body, opening, !!settings.enable_apps_sales);

    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const haveKinds = new Set(attachments.map((a) => a.kind));
    const missing = [];
    if (settings.require_foodics_img && !haveKinds.has('foodics_invoice')) missing.push('صورة فاتورة فودكس');
    if (settings.require_network_img && !haveKinds.has('network')) missing.push('صورة جهاز الشبكة');
    if (settings.require_cash_img && !haveKinds.has('cash')) missing.push('صورة الكاش');
    if (settings.enable_apps_sales && settings.require_apps_img && computed.apps_sales_halalas > 0 && !haveKinds.has('apps')) {
      missing.push('صورة شاشة التطبيقات');
    }
    if (settings.require_custody_receipt_img && computed.custody_expense_halalas > 0 && !haveKinds.has('custody_receipt')) {
      missing.push('إيصال مصاريف العهدة');
    }
    if (missing.length) throw { status: 400, message: `صور ناقصة: ${missing.join('، ')}` };

    const closingId = newId();
    const submittedAt = Date.now();
    const appsInvoiceCount = Math.max(0, parseInt(body.apps_invoice_count || 0, 10));
    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;
    const custodyNote = body.custody_expense_note ? String(body.custody_expense_note).slice(0, 500) : null;
    const slice500 = (v) => v ? String(v).slice(0, 500) : null;
    const keetaNote = slice500(body.keeta_note);
    const hsNote = slice500(body.hungerstation_note);
    const jahezNote = slice500(body.jahez_note);
    const ninjaNote = slice500(body.ninja_note);

    await tx(async (q) => {
      await q(
        `INSERT INTO closings (
           id, link_id, accountant_id, branch_id, safe_id, employee_id,
           total_sales_halalas, network_sales_halalas, apps_sales_halalas, apps_invoice_count, cash_sales_halalas,
           keeta_halalas, hungerstation_halalas, jahez_halalas, ninja_halalas,
           keeta_note, hungerstation_note, jahez_note, ninja_note,
           cash_in_safe_halalas, custody_in_hand_halalas, custody_expense_halalas, custody_expense_note,
           opening_balance_halalas, expected_cash_halalas, variance_halalas,
           notes, status, submitted_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'pending',$28)`,
        [
          closingId, link.id, link.accountant_id, link.branch_id, link.safe_id, link.employee_id,
          computed.total_sales_halalas, computed.network_sales_halalas, computed.apps_sales_halalas, appsInvoiceCount, computed.cash_sales_halalas,
          computed.keeta_halalas, computed.hungerstation_halalas, computed.jahez_halalas, computed.ninja_halalas,
          keetaNote, hsNote, jahezNote, ninjaNote,
          computed.cash_in_safe_halalas, computed.custody_in_hand_halalas, computed.custody_expense_halalas, custodyNote,
          computed.opening_balance_halalas, computed.expected_cash_halalas, computed.variance_halalas,
          notes, submittedAt,
        ]
      );

      for (const a of attachments) {
        if (!ALLOWED_KINDS.has(a.kind)) continue;
        if (typeof a.storage_key !== 'string' || !a.storage_key.startsWith(`pending/${linkId}/`)) continue;
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
