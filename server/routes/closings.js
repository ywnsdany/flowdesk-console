import { requireAccountant, requireCsrf, signJwt } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn, tx } from '../db.js';
import { newId } from '../ids.js';
import { send, readJson } from '../router.js';
import { confirmedDir, moveKey, deleteKey } from '../storage.js';

export function mountClosings(router) {
  router.GET('/api/closings', async (req, res) => {
    const me = requireAccountant(req);
    const status = req.query.status;
    const branchId = req.query.branch_id;
    const safeId = req.query.safe_id;
    const from = req.query.from ? parseInt(req.query.from, 10) : null;
    const to = req.query.to ? parseInt(req.query.to, 10) : null;
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);

    const where = ['c.accountant_id = ?'];
    const args = [me.id];
    if (status) { where.push('c.status = ?'); args.push(status); }
    if (branchId) { where.push('c.branch_id = ?'); args.push(branchId); }
    if (safeId) { where.push('c.safe_id = ?'); args.push(safeId); }
    if (from) { where.push('c.submitted_at >= ?'); args.push(from); }
    if (to) { where.push('c.submitted_at <= ?'); args.push(to); }

    const rows = getDb().prepare(
      `SELECT c.id, c.status, c.submitted_at, c.reviewed_at,
              c.total_sales_halalas, c.network_sales_halalas, c.apps_sales_halalas, c.cash_sales_halalas,
              c.cash_in_safe_halalas, c.expected_cash_halalas, c.variance_halalas,
              c.custody_expense_halalas, c.notes, c.reject_reason,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.submitted_at DESC
       LIMIT ?`
    ).all(...args, limit);
    send(res, 200, { items: rows });
  });

  router.GET('/api/closings/:id', async (req, res) => {
    const me = requireAccountant(req);
    const { id } = req.params;
    requireOwn('closings', id, me.id);
    const c = getDb().prepare(
      `SELECT c.*, br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.id = ?`
    ).get(id);
    const attachments = getDb().prepare(
      'SELECT id, kind, storage_key, mime, size, created_at FROM attachments WHERE closing_id = ? ORDER BY created_at'
    ).all(id);
    // Sign short-lived URLs for each attachment.
    const signed = attachments.map((a) => ({
      ...a,
      url: `/api/files?t=${signJwt({ k: a.storage_key, sub: me.id }, 5 * 60)}`,
    }));
    send(res, 200, { closing: c, attachments: signed });
  });

  router.POST('/api/closings/:id/confirm', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('closings', id, me.id);
    const c = getDb().prepare('SELECT * FROM closings WHERE id = ?').get(id);
    if (c.status !== 'pending') throw { status: 400, message: 'closing is not pending' };

    tx(() => {
      // 1) Cash movement: cash_in_safe is the new safe balance after this shift.
      const lastBalance = getDb().prepare(
        'SELECT balance_after_halalas FROM cash_movements WHERE safe_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(c.safe_id);
      const prevBalance = lastBalance?.balance_after_halalas ?? c.opening_balance_halalas;
      const delta = c.cash_in_safe_halalas - prevBalance;
      getDb().prepare(
        `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
         VALUES (?, ?, 'closing_confirm', ?, ?, ?, ?)`
      ).run(newId(), c.safe_id, c.id, delta, c.cash_in_safe_halalas, Date.now());

      // 2) Custody: deduct expense from employee balance.
      if (c.employee_id && c.custody_expense_halalas > 0) {
        const emp = getDb().prepare('SELECT custody_balance_halalas FROM employees WHERE id = ?').get(c.employee_id);
        const newBal = emp.custody_balance_halalas - c.custody_expense_halalas;
        getDb().prepare('UPDATE employees SET custody_balance_halalas = ? WHERE id = ?').run(newBal, c.employee_id);
        getDb().prepare(
          `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
           VALUES (?, ?, 'expense', ?, ?, ?, ?)`
        ).run(newId(), c.employee_id, c.id, -c.custody_expense_halalas, newBal, Date.now());
      }

      // 3) Move attachments from pending → confirmed.
      const atts = getDb().prepare('SELECT id, storage_key FROM attachments WHERE closing_id = ?').all(c.id);
      const updateAttKey = getDb().prepare('UPDATE attachments SET storage_key = ? WHERE id = ?');
      for (const a of atts) {
        if (a.storage_key.startsWith('pending/')) {
          const filename = a.storage_key.split('/').pop();
          const newKey = `confirmed/${c.id}/${filename}`;
          confirmedDir(c.id);
          try { moveKey(a.storage_key, newKey); } catch {}
          updateAttKey.run(newKey, a.id);
        }
      }

      getDb().prepare('UPDATE closings SET status = ?, reviewed_at = ? WHERE id = ?').run('confirmed', Date.now(), c.id);
    });

    audit(me.id, 'confirm', 'closing', c.id, { status: 'pending' }, { status: 'confirmed' });
    send(res, 200, { ok: true });
  });

  router.POST('/api/closings/:id/reject', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('closings', id, me.id);
    const body = await readJson(req);
    const reason = String(body.reason || '').trim();
    if (!reason) throw { status: 400, message: 'reason is required' };
    const c = getDb().prepare('SELECT status FROM closings WHERE id = ?').get(id);
    if (c.status !== 'pending') throw { status: 400, message: 'closing is not pending' };
    tx(() => {
      // Delete pending attachments from disk (we keep the records for audit).
      const atts = getDb().prepare('SELECT id, storage_key FROM attachments WHERE closing_id = ?').all(id);
      for (const a of atts) {
        if (a.storage_key.startsWith('pending/')) {
          try { deleteKey(a.storage_key); } catch {}
        }
      }
      getDb().prepare('UPDATE closings SET status = ?, reject_reason = ?, reviewed_at = ? WHERE id = ?')
        .run('rejected', reason, Date.now(), id);
    });
    audit(me.id, 'reject', 'closing', id, { status: 'pending' }, { status: 'rejected', reason });
    send(res, 200, { ok: true });
  });
}
