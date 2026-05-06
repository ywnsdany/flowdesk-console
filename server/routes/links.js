import { hashPin, requireAccountant, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn } from '../db.js';
import { newId, newToken } from '../ids.js';
import { readJson, send } from '../router.js';

function generatePin() {
  // 6 random digits.
  const buf = new Uint8Array(6);
  for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 10);
  return Array.from(buf).join('');
}

export function mountLinks(router) {
  router.GET('/api/links', async (req, res) => {
    const me = requireAccountant(req);
    const rows = getDb().prepare(
      `SELECT l.id, l.token, l.status, l.created_at, l.pin_version,
              l.branch_id, l.safe_id, l.employee_id,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM cashier_links l
       JOIN branches b ON b.id = l.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = l.safe_id
       LEFT JOIN employees e ON e.id = l.employee_id
       WHERE l.accountant_id = ?
       ORDER BY l.created_at DESC`
    ).all(me.id);
    send(res, 200, { items: rows });
  });

  router.POST('/api/links', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const branchId = String(body.branch_id || '').trim();
    const safeId = String(body.safe_id || '').trim();
    const employeeId = body.employee_id ? String(body.employee_id).trim() : null;
    if (!branchId || !safeId) throw { status: 400, message: 'branch_id and safe_id are required' };
    requireOwn('branches', branchId, me.id);
    requireOwn('safes', safeId, me.id);
    if (employeeId) requireOwn('employees', employeeId, me.id);

    // Sanity: safe must belong to branch (and employee too, if any).
    const safe = getDb().prepare('SELECT branch_id FROM safes WHERE id = ?').get(safeId);
    if (safe.branch_id !== branchId) throw { status: 400, message: 'safe does not belong to branch' };
    if (employeeId) {
      const emp = getDb().prepare('SELECT branch_id FROM employees WHERE id = ?').get(employeeId);
      if (emp.branch_id !== branchId) throw { status: 400, message: 'employee does not belong to branch' };
    }

    const id = newId();
    const token = newToken(48);
    const pin = generatePin();
    const { salt, hash } = hashPin(pin);
    getDb().prepare(
      `INSERT INTO cashier_links (id, accountant_id, branch_id, safe_id, employee_id, token, pin_hash, pin_salt, pin_version, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)`
    ).run(id, me.id, branchId, safeId, employeeId, token, hash, salt, Date.now());
    audit(me.id, 'create', 'cashier_link', id, null, { branch_id: branchId, safe_id: safeId, employee_id: employeeId });
    // Return PIN only once.
    send(res, 200, { id, token, pin });
  });

  router.POST('/api/links/:id/regenerate-pin', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('cashier_links', id, me.id);
    const pin = generatePin();
    const { salt, hash } = hashPin(pin);
    getDb().prepare(
      'UPDATE cashier_links SET pin_hash = ?, pin_salt = ?, pin_version = pin_version + 1 WHERE id = ?'
    ).run(hash, salt, id);
    audit(me.id, 'regenerate_pin', 'cashier_link', id, null, null);
    send(res, 200, { pin });
  });

  router.PATCH('/api/links/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('cashier_links', id, me.id);
    const body = await readJson(req);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const before = getDb().prepare('SELECT status FROM cashier_links WHERE id = ?').get(id);
    getDb().prepare('UPDATE cashier_links SET status = ? WHERE id = ?').run(status, id);
    audit(me.id, 'update', 'cashier_link', id, before, { status });
    send(res, 200, { id, status });
  });

  router.DELETE('/api/links/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('cashier_links', id, me.id);
    getDb().prepare('DELETE FROM cashier_links WHERE id = ?').run(id);
    audit(me.id, 'delete', 'cashier_link', id, null, null);
    send(res, 200, { ok: true });
  });
}
