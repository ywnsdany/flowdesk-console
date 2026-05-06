import { requireAccountant, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn, tx } from '../db.js';
import { newId } from '../ids.js';
import { toHalalas } from '../money.js';
import { readJson, send } from '../router.js';

export function mountEmployees(router) {
  router.GET('/api/employees', async (req, res) => {
    const me = requireAccountant(req);
    const branchId = req.query.branch_id;
    const sql = `SELECT e.id, e.name, e.branch_id, e.custody_balance_halalas, e.created_at,
                        b.name AS branch_name, br.name AS brand_name
                 FROM employees e JOIN branches b ON b.id = e.branch_id JOIN brands br ON br.id = b.brand_id
                 WHERE e.accountant_id = ?
                 ${branchId ? 'AND e.branch_id = ?' : ''}
                 ORDER BY e.created_at DESC`;
    const rows = branchId
      ? getDb().prepare(sql).all(me.id, branchId)
      : getDb().prepare(sql).all(me.id);
    send(res, 200, { items: rows });
  });

  router.GET('/api/employees/:id/custody-ledger', async (req, res) => {
    const me = requireAccountant(req);
    const { id } = req.params;
    requireOwn('employees', id, me.id);
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
    const rows = getDb().prepare(
      `SELECT id, type, ref_id, amount_halalas, balance_after_halalas, created_at
       FROM custody_movements WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(id, limit);
    send(res, 200, { items: rows });
  });

  router.POST('/api/employees', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const branchId = String(body.branch_id || '').trim();
    const custody = toHalalas(body.custody_balance);
    if (!name) throw { status: 400, message: 'name is required' };
    if (!branchId) throw { status: 400, message: 'branch_id is required' };
    if (custody < 0) throw { status: 400, message: 'custody balance cannot be negative' };
    requireOwn('branches', branchId, me.id);

    const id = newId();
    tx(() => {
      getDb().prepare('INSERT INTO employees (id, branch_id, accountant_id, name, custody_balance_halalas, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, branchId, me.id, name, custody, Date.now());
      if (custody > 0) {
        getDb().prepare(
          `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at) VALUES (?, ?, 'opening', NULL, ?, ?, ?)`
        ).run(newId(), id, custody, custody, Date.now());
      }
    });
    audit(me.id, 'create', 'employee', id, null, { name, branch_id: branchId, custody_balance_halalas: custody });
    send(res, 200, { id, name, branch_id: branchId, custody_balance_halalas: custody });
  });

  router.PATCH('/api/employees/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('employees', id, me.id);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    const before = getDb().prepare('SELECT name FROM employees WHERE id = ?').get(id);
    getDb().prepare('UPDATE employees SET name = ? WHERE id = ?').run(name, id);
    audit(me.id, 'update', 'employee', id, before, { name });
    send(res, 200, { id, name });
  });

  router.POST('/api/employees/:id/topup', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('employees', id, me.id);
    const body = await readJson(req);
    const amount = toHalalas(body.amount);
    if (amount <= 0) throw { status: 400, message: 'amount must be positive' };
    tx(() => {
      const row = getDb().prepare('SELECT custody_balance_halalas FROM employees WHERE id = ?').get(id);
      const newBalance = row.custody_balance_halalas + amount;
      getDb().prepare('UPDATE employees SET custody_balance_halalas = ? WHERE id = ?').run(newBalance, id);
      getDb().prepare(
        `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at) VALUES (?, ?, 'topup', NULL, ?, ?, ?)`
      ).run(newId(), id, amount, newBalance, Date.now());
    });
    audit(me.id, 'topup', 'employee', id, null, { amount });
    send(res, 200, { ok: true });
  });

  router.DELETE('/api/employees/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('employees', id, me.id);
    const before = getDb().prepare('SELECT name, branch_id FROM employees WHERE id = ?').get(id);
    getDb().prepare('DELETE FROM employees WHERE id = ?').run(id);
    audit(me.id, 'delete', 'employee', id, before, null);
    send(res, 200, { ok: true });
  });
}
