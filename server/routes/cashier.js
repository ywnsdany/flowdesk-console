import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { signJwt, verifyJwt, verifyPin } from '../auth.js';
import { getDb, tx } from '../db.js';
import { newId } from '../ids.js';
import { computeClosing } from '../money.js';
import { parseMultipart } from '../multipart.js';
import { checkPinRateLimit, recordPinAttempt } from '../pin.js';
import { getClientIp, readJson, send } from '../router.js';
import { absPath, pendingDir } from '../storage.js';

const ALLOWED_KINDS = new Set(['foodics_invoice', 'network', 'apps', 'cash', 'custody_receipt', 'other']);
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_UPLOAD = 8 * 1024 * 1024;

function readScopedJwt(req, expectedLinkId) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) throw { status: 401, message: 'unauthorized' };
  const payload = verifyJwt(m[1]);
  if (!payload || payload.scope !== 'cashier' || payload.link_id !== expectedLinkId) {
    throw { status: 401, message: 'invalid session' };
  }
  // Verify pin_version still matches.
  const link = getDb().prepare('SELECT pin_version, status FROM cashier_links WHERE id = ?').get(payload.link_id);
  if (!link || link.status !== 'active' || link.pin_version !== payload.pin_version) {
    throw { status: 401, message: 'session invalidated' };
  }
  return payload;
}

export function mountCashier(router) {
  // GET link metadata + branch settings (no PIN yet).
  router.GET('/api/cashier/link', async (req, res) => {
    const linkId = String(req.query.l || '');
    const token = String(req.query.t || '');
    if (!linkId || !token) throw { status: 400, message: 'missing link or token' };
    const link = getDb().prepare(
      `SELECT l.id, l.token, l.status, l.branch_id, l.safe_id, l.employee_id,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM cashier_links l
       JOIN branches b ON b.id = l.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = l.safe_id
       LEFT JOIN employees e ON e.id = l.employee_id
       WHERE l.id = ? AND l.token = ?`
    ).get(linkId, token);
    if (!link || link.status !== 'active') throw { status: 404, message: 'invalid link' };
    const settings = getDb().prepare('SELECT * FROM branch_settings WHERE branch_id = ?').get(link.branch_id) || {
      enable_apps_sales: 1,
      require_foodics_img: 1, require_network_img: 1, require_apps_img: 1, require_cash_img: 1, require_custody_receipt_img: 1,
    };
    send(res, 200, {
      link: {
        id: link.id,
        brand_name: link.brand_name,
        branch_name: link.branch_name,
        safe_name: link.safe_name,
        employee_name: link.employee_name,
      },
      settings: {
        enable_apps_sales: !!settings.enable_apps_sales,
        require_foodics_img: !!settings.require_foodics_img,
        require_network_img: !!settings.require_network_img,
        require_apps_img: !!settings.require_apps_img,
        require_cash_img: !!settings.require_cash_img,
        require_custody_receipt_img: !!settings.require_custody_receipt_img,
      },
    });
  });

  // POST PIN → JWT scoped (30 min).
  router.POST('/api/cashier/pin', async (req, res) => {
    const ip = getClientIp(req);
    const body = await readJson(req);
    const linkId = String(body.link_id || '');
    const token = String(body.token || '');
    const pin = String(body.pin || '');
    if (!linkId || !token || !/^\d{4,8}$/.test(pin)) throw { status: 400, message: 'invalid input' };
    const link = getDb().prepare(
      'SELECT id, token, pin_hash, pin_salt, pin_version, status FROM cashier_links WHERE id = ?'
    ).get(linkId);
    if (!link || link.token !== token || link.status !== 'active') throw { status: 404, message: 'invalid link' };
    checkPinRateLimit(linkId, ip);
    const ok = verifyPin(pin, link.pin_salt, link.pin_hash);
    recordPinAttempt(linkId, ip, ok);
    if (!ok) throw { status: 401, message: 'PIN غير صحيح' };
    const jwt = signJwt({ scope: 'cashier', link_id: linkId, pin_version: link.pin_version }, 30 * 60);
    send(res, 200, { token: jwt, expires_in: 30 * 60 });
  });

  // POST upload → multipart with field "file" + "kind" + "link_id".
  router.POST('/api/cashier/upload', async (req, res) => {
    const linkId = String(req.query.l || '');
    if (!linkId) throw { status: 400, message: 'missing link' };
    readScopedJwt(req, linkId);
    const parts = await parseMultipart(req, MAX_UPLOAD);
    const filePart = parts.find((p) => p.filename);
    const kindPart = parts.find((p) => p.name === 'kind');
    if (!filePart) throw { status: 400, message: 'no file' };
    const kind = (kindPart?.data?.toString('utf8') || 'other').trim();
    if (!ALLOWED_KINDS.has(kind)) throw { status: 400, message: 'invalid kind' };
    const mime = (filePart.contentType || '').toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) throw { status: 400, message: 'invalid file type' };
    if (filePart.data.length > MAX_UPLOAD) throw { status: 413, message: 'file too large' };

    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })[mime] || 'bin';
    const fileId = newId();
    const storageKey = `pending/${linkId}/${fileId}.${ext}`;
    pendingDir(linkId);
    writeFileSync(absPath(storageKey), filePart.data);
    send(res, 200, {
      storage_key: storageKey,
      kind,
      mime,
      size: filePart.data.length,
    });
  });

  // POST closing — submit final.
  router.POST('/api/cashier/closing', async (req, res) => {
    const linkId = String(req.query.l || '');
    if (!linkId) throw { status: 400, message: 'missing link' };
    readScopedJwt(req, linkId);
    const body = await readJson(req);

    const link = getDb().prepare(
      `SELECT l.id, l.accountant_id, l.branch_id, l.safe_id, l.employee_id, s.opening_balance_halalas
       FROM cashier_links l JOIN safes s ON s.id = l.safe_id
       WHERE l.id = ?`
    ).get(linkId);
    if (!link) throw { status: 404, message: 'invalid link' };

    // Determine opening balance: last cash_movement balance, or safe.opening.
    const lastMove = getDb().prepare(
      'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(link.safe_id);
    const opening = lastMove ? lastMove.balance_after_halalas : link.opening_balance_halalas;

    // Settings → ensure required attachments are present.
    const settings = getDb().prepare('SELECT * FROM branch_settings WHERE branch_id = ?').get(link.branch_id) || {
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

    tx(() => {
      getDb().prepare(
        `INSERT INTO closings (
           id, link_id, accountant_id, branch_id, safe_id, employee_id,
           total_sales_halalas, network_sales_halalas, apps_sales_halalas, apps_invoice_count, cash_sales_halalas,
           keeta_halalas, hungerstation_halalas, jahez_halalas, ninja_halalas,
           cash_in_safe_halalas, custody_in_hand_halalas, custody_expense_halalas, custody_expense_note,
           opening_balance_halalas, expected_cash_halalas, variance_halalas,
           notes, status, submitted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).run(
        closingId, link.id, link.accountant_id, link.branch_id, link.safe_id, link.employee_id,
        computed.total_sales_halalas, computed.network_sales_halalas, computed.apps_sales_halalas, appsInvoiceCount, computed.cash_sales_halalas,
        computed.keeta_halalas, computed.hungerstation_halalas, computed.jahez_halalas, computed.ninja_halalas,
        computed.cash_in_safe_halalas, computed.custody_in_hand_halalas, computed.custody_expense_halalas, custodyNote,
        computed.opening_balance_halalas, computed.expected_cash_halalas, computed.variance_halalas,
        notes, submittedAt
      );

      const insertAtt = getDb().prepare(
        'INSERT INTO attachments (id, closing_id, kind, storage_key, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const a of attachments) {
        if (!ALLOWED_KINDS.has(a.kind)) continue;
        if (typeof a.storage_key !== 'string' || !a.storage_key.startsWith(`pending/${linkId}/`)) continue;
        insertAtt.run(newId(), closingId, a.kind, a.storage_key, a.mime || 'application/octet-stream', a.size || 0, Date.now());
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
  });
}
