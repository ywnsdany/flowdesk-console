import { authCookies, verifyPassword } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

// Single login flow by username (case-insensitive).
// Tries accountants (admin) first, then employees.
export default handler({
  POST: async (req, res) => {
    const body = await readJson(req);
    const username = String(body.username || body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!username || !password) throw { status: 400, message: 'بيانات الدخول مطلوبة' };

    // 1) Admin?
    const admin = await one(
      `SELECT id, username, password_hash, password_salt
       FROM accountants WHERE LOWER(username) = $1 AND password_hash IS NOT NULL`,
      [username]
    );
    if (admin && verifyPassword(password, admin.password_salt, admin.password_hash)) {
      return send(res, 200, {
        id: admin.id, username: admin.username, role: 'admin',
      }, { 'Set-Cookie': authCookies(admin.id, { role: 'admin' }) });
    }

    // 2) Employee (cashier or collector)?
    const emp = await one(
      `SELECT id, accountant_id, name, username, password_hash, password_salt, status, role
       FROM employees WHERE LOWER(username) = $1 AND password_hash IS NOT NULL`,
      [username]
    );
    if (emp && emp.status === 'active' && verifyPassword(password, emp.password_salt, emp.password_hash)) {
      const sessionRole = emp.role === 'collector' ? 'collector' : 'employee';
      return send(res, 200, {
        id: emp.id, name: emp.name, username: emp.username, role: sessionRole,
      }, { 'Set-Cookie': authCookies(emp.id, { role: sessionRole, ownerId: emp.accountant_id }) });
    }

    throw { status: 401, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  },
});
