import { requireAccountant, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn, tx } from '../db.js';
import { newId } from '../ids.js';
import { toHalalas } from '../money.js';
import { readJson, send } from '../router.js';

export function mountSafes(router) {
  router.GET('/api/safes', async (req, res) => {
    const me = requireAccountant(req);
    const branchId = req.query.branch_id;
    const sql = `SELECT s.id, s.name, s.branch_id, s.opening_balance_halalas, s.created_at,
                        b.name AS branch_name, br.name AS brand_name,
                        COALESCE((SELECT balance_after_halalas FROM cash_movements WHERE safe_id = s.id ORDER BY created_at DESC LIMIT 1),
                                 s.opening_balance_halalas) AS current_balance_halalas
                 FROM safes s JOIN branches b ON b.id = s.branch_id JOIN brands br ON br.id = b.brand_id
                 WHERE s.accountant_id = ?
                 ${branchId ? 'AND s.branch_id = ?' : ''}
                 ORDER BY s.created_at DESC`;
    const rows = branchId
      ? getDb().prepare(sql).all(me.id, branchId)
      : getDb().prepare(sql).all(me.id);
    send(res, 200, { items: rows });
  });

  router.GET('/api/safes/:id/ledger', async (req, res) => {
    const me = requireAccountant(req);
    const { id } = req.params;
    requireOwn('safes', id, me.id);
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
    const rows = getDb().prepare(
      `SELECT id, type, ref_id, amount_halalas, balance_after_halalas, created_at
       FROM cash_movements WHERE safe_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(id, limit);
    send(res, 200, { items: rows });
  });

  router.POST('/api/safes', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const branchId = String(body.branch_id || '').trim();
    const opening = toHalalas(body.opening_balance);
    if (!name) throw { status: 400, message: 'name is required' };
    if (!branchId) throw { status: 400, message: 'branch_id is required' };
    if (opening < 0) throw { status: 400, message: 'opening balance cannot be negative' };
    requireOwn('branches', branchId, me.id);

    const id = newId();
    tx(() => {
      getDb().prepare('INSERT INTO safes (id, branch_id, accountant_id, name, opening_balance_halalas, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, branchId, me.id, name, opening, Date.now());
      if (opening > 0) {
        getDb().prepare(
          `INSERT INTO cash_movements (id, safe_id, type, ref_id, amount_halalas, balance_after_halalas, created_at) VALUES (?, ?, 'opening', NULL, ?, ?, ?)`
        ).run(newId(), id, opening, opening, Date.now());
      }
    });
    audit(me.id, 'create', 'safe', id, null, { name, branch_id: branchId, opening_balance_halalas: opening });
    send(res, 200, { id, name, branch_id: branchId, opening_balance_halalas: opening });
  });

  router.PATCH('/api/safes/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('safes', id, me.id);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    const before = getDb().prepare('SELECT name FROM safes WHERE id = ?').get(id);
    getDb().prepare('UPDATE safes SET name = ? WHERE id = ?').run(name, id);
    audit(me.id, 'update', 'safe', id, before, { name });
    send(res, 200, { id, name });
  });

  router.DELETE('/api/safes/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('safes', id, me.id);
    const before = getDb().prepare('SELECT name, branch_id FROM safes WHERE id = ?').get(id);
    getDb().prepare('DELETE FROM safes WHERE id = ?').run(id);
    audit(me.id, 'delete', 'safe', id, before, null);
    send(res, 200, { ok: true });
  });
}
