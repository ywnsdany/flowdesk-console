import { hashPin, requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn } from '../_lib/db.js';
import { newId, newToken } from '../_lib/ids.js';
import { handler, readJson, send } from '../_lib/http.js';

function generatePin() {
  const buf = new Uint8Array(6);
  for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 10);
  return Array.from(buf).join('');
}

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const rows = await query(
      `SELECT l.id, l.token, l.status, l.created_at, l.pin_version,
              l.branch_id, l.safe_id, l.employee_id,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM cashier_links l
       JOIN branches b ON b.id = l.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = l.safe_id
       LEFT JOIN employees e ON e.id = l.employee_id
       WHERE l.accountant_id = $1
       ORDER BY l.created_at DESC`,
      [me.id]
    );
    send(res, 200, { items: rows });
  },

  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const branchId = String(body.branch_id || '').trim();
    const safeId = String(body.safe_id || '').trim();
    const employeeId = body.employee_id ? String(body.employee_id).trim() : null;
    if (!branchId || !safeId) throw { status: 400, message: 'branch_id and safe_id are required' };
    await requireOwn('branches', branchId, me.id);
    await requireOwn('safes', safeId, me.id);
    if (employeeId) await requireOwn('employees', employeeId, me.id);

    const safe = await one('SELECT branch_id FROM safes WHERE id = $1', [safeId]);
    if (safe.branch_id !== branchId) throw { status: 400, message: 'safe does not belong to branch' };
    if (employeeId) {
      const emp = await one('SELECT branch_id FROM employees WHERE id = $1', [employeeId]);
      if (emp.branch_id !== branchId) throw { status: 400, message: 'employee does not belong to branch' };
    }

    const id = newId();
    const token = newToken(48);
    const pin = generatePin();
    const { salt, hash } = hashPin(pin);
    await query(
      `INSERT INTO cashier_links (id, accountant_id, branch_id, safe_id, employee_id, token, pin_hash, pin_salt, pin_version, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'active', $9)`,
      [id, me.id, branchId, safeId, employeeId, token, hash, salt, Date.now()]
    );
    await audit(me.id, 'create', 'cashier_link', id, null, { branch_id: branchId, safe_id: safeId, employee_id: employeeId });
    send(res, 200, { id, token, pin });
  },
});
