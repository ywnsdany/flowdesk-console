import { writeFileSync } from 'node:fs';
import { signJwt, requireAccountant, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn, tx } from '../db.js';
import { newId } from '../ids.js';
import { toHalalas } from '../money.js';
import { parseRiyadhDate } from '../date.js';
import { parseMultipart } from '../multipart.js';
import { send, readJson } from '../router.js';
import { absPath, confirmedDir, deleteKey } from '../storage.js';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
const MAX_UPLOAD = 8 * 1024 * 1024;

export function mountDeposits(router) {
  router.GET('/api/deposits', async (req, res) => {
    const me = requireAccountant(req);
    const safeId = req.query.safe_id;
    const sql = `SELECT d.id, d.safe_id, d.amount_halalas, d.deposit_date, d.note, d.receipt_storage_key, d.created_at,
                        s.name AS safe_name, b.name AS branch_name, br.name AS brand_name
                 FROM bank_deposits d
                 JOIN safes s ON s.id = d.safe_id
                 JOIN branches b ON b.id = s.branch_id
                 JOIN brands br ON br.id = b.brand_id
                 WHERE d.accountant_id = ?
                 ${safeId ? 'AND d.safe_id = ?' : ''}
                 ORDER BY d.deposit_date DESC, d.created_at DESC`;
    const rows = safeId
      ? getDb().prepare(sql).all(me.id, safeId)
      : getDb().prepare(sql).all(me.id);
    const items = rows.map((r) => ({
      ...r,
      receipt_url: r.receipt_storage_key ? `/api/files?t=${signJwt({ k: r.receipt_storage_key, sub: me.id }, 5 * 60)}` : null,
    }));
    send(res, 200, { items });
  });

  router.POST('/api/deposits', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    // multipart with optional receipt + JSON fields safe_id, amount, deposit_date, note.
    let safeId, amount, depositDate, note, receiptKey = null;
    const ct = req.headers['content-type'] || '';

    if (ct.startsWith('multipart/form-data')) {
      const parts = await parseMultipart(req, MAX_UPLOAD);
      const get = (n) => parts.find((p) => p.name === n)?.data?.toString('utf8');
      safeId = get('safe_id');
      amount = get('amount');
      depositDate = get('deposit_date');
      note = get('note');
      const file = parts.find((p) => p.filename);
      if (file) {
        const mime = (file.contentType || '').toLowerCase();
        if (!ALLOWED_MIMES.has(mime)) throw { status: 400, message: 'invalid file type' };
        if (file.data.length > MAX_UPLOAD) throw { status: 413, message: 'file too large' };
        if (!safeId) throw { status: 400, message: 'safe_id is required' };
        requireOwn('safes', safeId, me.id);
        const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' })[mime] || 'bin';
        const fileId = newId();
        receiptKey = `confirmed/deposits/${safeId}/${fileId}.${ext}`;
        confirmedDir(`deposits/${safeId}`);
        writeFileSync(absPath(receiptKey), file.data);
      }
    } else {
      const body = await readJson(req);
      safeId = body.safe_id; amount = body.amount; depositDate = body.deposit_date; note = body.note;
    }

    if (!safeId) throw { status: 400, message: 'safe_id is required' };
    requireOwn('safes', safeId, me.id);
    const amountH = toHalalas(amount);
    if (amountH <= 0) throw { status: 400, message: 'amount must be positive' };
    let dateMs;
    if (depositDate) dateMs = parseRiyadhDate(depositDate);
    else dateMs = Date.now();
    const id = newId();
    const noteText = note ? String(note).slice(0, 500) : null;

    tx(() => {
      const lastBalance = getDb().prepare(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(safeId);
      const safeOpening = getDb().prepare('SELECT opening_balance_halalas FROM safes WHERE id = ?').get(safeId).opening_balance_halalas;
      const prev = lastBalance ? lastBalance.balance_after_halalas : safeOpening;
      const newBal = prev - amountH;
      getDb().prepare(
        `INSERT INTO bank_deposits (id, accountant_id, safe_id, amount_halalas, deposit_date, receipt_storage_key, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, me.id, safeId, amountH, dateMs, receiptKey, noteText, Date.now());
      getDb().prepare(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES (?, ?, 'deposit', ?, ?, ?, ?)`
      ).run(newId(), safeId, id, -amountH, newBal, Date.now());
    });
    audit(me.id, 'create', 'bank_deposit', id, null, { safe_id: safeId, amount_halalas: amountH });
    send(res, 200, { id });
  });

  router.DELETE('/api/deposits/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    const row = getDb().prepare('SELECT * FROM bank_deposits WHERE id = ?').get(id);
    if (!row) throw { status: 404, message: 'not found' };
    if (row.accountant_id !== me.id) throw { status: 403, message: 'forbidden' };
    // Reverse the ledger entry by inserting an opposite movement.
    tx(() => {
      const lastBalance = getDb().prepare(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(row.safe_id);
      const prev = lastBalance ? lastBalance.balance_after_halalas : 0;
      const newBal = prev + row.amount_halalas;
      getDb().prepare(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES (?, ?, 'adjustment', ?, ?, ?, ?)`
      ).run(newId(), row.safe_id, id, row.amount_halalas, newBal, Date.now());
      getDb().prepare('DELETE FROM bank_deposits WHERE id = ?').run(id);
      if (row.receipt_storage_key) {
        try { deleteKey(row.receipt_storage_key); } catch {}
      }
    });
    audit(me.id, 'delete', 'bank_deposit', id, row, null);
    send(res, 200, { ok: true });
  });
}
