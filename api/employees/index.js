import { hashPassword, requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { toHalalas } from '../_lib/money.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const branchId = req.query.branch_id;
    const sql = `
      SELECT e.id, e.name, e.username, e.status, e.role,
             e.custody_balance_halalas, e.created_at,
             COALESCE(
               (SELECT json_agg(json_build_object('id', b.id, 'name', b.name, 'brand_name', br.name)
                       ORDER BY br.name, b.name)
                FROM user_branches ub
                JOIN branches b ON b.id = ub.branch_id
                JOIN brands br ON br.id = b.brand_id
                WHERE ub.employee_id = e.id),
               '[]'::json
             ) AS branches,
             COALESCE(
               (SELECT balance_after_halalas FROM collector_movements
                WHERE collector_id = e.id ORDER BY created_at DESC LIMIT 1),
               0
             ) AS wallet_balance_halalas
      FROM employees e
      WHERE e.accountant_id = $1
      ${branchId ? 'AND EXISTS (SELECT 1 FROM user_branches WHERE employee_id = e.id AND branch_id = $2)' : ''}
      ORDER BY e.created_at DESC`;
    const rows = branchId ? await query(sql, [me.id, branchId]) : await query(sql, [me.id]);
    send(res, 200, { items: rows });
  },

  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids : [];
    const custody = toHalalas(body.custody_balance);
    const role = body.role === 'collector' ? 'collector' : 'cashier';

    if (!name) throw { status: 400, message: 'الاسم مطلوب' };
    if (!username || !/^[a-z0-9_.-]{3,32}$/i.test(username)) {
      throw { status: 400, message: 'اسم المستخدم لازم ٣–٣٢ حرف (إنجليزي/أرقام/_-.)' };
    }
    if (password.length < 6) throw { status: 400, message: 'كلمة المرور ٦ أحرف على الأقل' };
    if (!branchIds.length) throw { status: 400, message: 'اختر فرعاً واحداً على الأقل' };
    if (custody < 0) throw { status: 400, message: 'العهدة الافتتاحية لا يمكن أن تكون سالبة' };

    for (const bid of branchIds) await requireOwn('branches', bid, me.id);

    const existing = await one(
      'SELECT id FROM employees WHERE accountant_id = $1 AND LOWER(username) = $2',
      [me.id, username]
    );
    if (existing) throw { status: 409, message: 'اسم المستخدم مستخدم من قبل' };

    const id = newId();
    const { salt, hash } = hashPassword(password);
    const primaryBranch = branchIds[0];

    await tx(async (q) => {
      await q(
        `INSERT INTO employees (id, branch_id, accountant_id, name, username, password_hash, password_salt, status, custody_balance_halalas, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10)`,
        [id, primaryBranch, me.id, name, username, hash, salt, custody, role, Date.now()]
      );
      for (const bid of branchIds) {
        await q(
          'INSERT INTO user_branches (employee_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, bid]
        );
      }
      if (custody > 0) {
        await q(
          `INSERT INTO custody_movements (id, employee_id, type, ref_id, amount_halalas, balance_after_halalas, created_at)
           VALUES ($1, $2, 'opening', NULL, $3, $4, $5)`,
          [newId(), id, custody, custody, Date.now()]
        );
      }
    });

    await audit(me.id, 'create', 'employee', id, null, { name, username, role, branch_ids: branchIds });
    send(res, 200, { id, name, username, role, branches: branchIds });
  },
});
