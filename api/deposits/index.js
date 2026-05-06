import { requireAccountant, requireCsrf, signJwt } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { toHalalas } from '../_lib/money.js';
import { parseRiyadhDate } from '../_lib/date.js';
import { parseMultipart } from '../_lib/multipart.js';
import { handler, readJson, send } from '../_lib/http.js';
import { uploadBytes } from '../_lib/blob.js';

export const config = { api: { bodyParser: false } };

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
const MAX_UPLOAD = 8 * 1024 * 1024;

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const safeId = req.query.safe_id;
    const sql = `SELECT d.id, d.safe_id, d.amount_halalas, d.deposit_date, d.note, d.receipt_storage_key, d.created_at,
                        s.name AS safe_name, b.name AS branch_name, br.name AS brand_name
                 FROM bank_deposits d
                 JOIN safes s ON s.id = d.safe_id
                 JOIN branches b ON b.id = s.branch_id
                 JOIN brands br ON br.id = b.brand_id
                 WHERE d.accountant_id = $1
                 ${safeId ? 'AND d.safe_id = $2' : ''}
                 ORDER BY d.deposit_date DESC, d.created_at DESC`;
    const rows = safeId ? await query(sql, [me.id, safeId]) : await query(sql, [me.id]);
    const items = rows.map((r) => ({
      ...r,
      receipt_url: r.receipt_storage_key
        ? `/api/files?t=${signJwt({ k: r.receipt_storage_key, sub: me.id }, 5 * 60)}`
        : null,
    }));
    send(res, 200, { items });
  },

  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
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
        await requireOwn('safes', safeId, me.id);
        const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' })[mime] || 'bin';
        const fileId = newId();
        receiptKey = `confirmed/deposits/${safeId}/${fileId}.${ext}`;
        await uploadBytes(receiptKey, file.data, { contentType: mime });
      }
    } else {
      const body = await readJson(req);
      safeId = body.safe_id; amount = body.amount; depositDate = body.deposit_date; note = body.note;
    }

    if (!safeId) throw { status: 400, message: 'safe_id is required' };
    await requireOwn('safes', safeId, me.id);
    const amountH = toHalalas(amount);
    if (amountH <= 0) throw { status: 400, message: 'amount must be positive' };
    const dateMs = depositDate ? parseRiyadhDate(depositDate) : Date.now();
    const id = newId();
    const noteText = note ? String(note).slice(0, 500) : null;

    await tx(async (q) => {
      const lastRows = await q(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = $1 ORDER BY created_at DESC LIMIT 1',
        [safeId]
      );
      const safeRow = await q('SELECT opening_balance_halalas FROM safes WHERE id = $1', [safeId]);
      const prev = lastRows[0]
        ? Number(lastRows[0].balance_after_halalas)
        : Number(safeRow[0].opening_balance_halalas);
      const newBal = prev - amountH;
      await q(
        `INSERT INTO bank_deposits (id, accountant_id, safe_id, amount_halalas, deposit_date, receipt_storage_key, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, me.id, safeId, amountH, dateMs, receiptKey, noteText, Date.now()]
      );
      await q(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES ($1, $2, 'deposit', $3, $4, $5, $6)`,
        [newId(), safeId, id, -amountH, newBal, Date.now()]
      );
    });
    await audit(me.id, 'create', 'bank_deposit', id, null, { safe_id: safeId, amount_halalas: amountH });
    send(res, 200, { id });
  },
});
