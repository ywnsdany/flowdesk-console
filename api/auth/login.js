import { authCookies, verifyPassword } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

// Unified login: tries admin (accountants) by email, then employee by username.
// Returns { id, role, name? }.
export default handler({
  POST: async (req, res) => {
    const body = await readJson(req);
    const identifier = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!identifier || !password) throw { status: 400, message: 'missing credentials' };

    // Try admin first if it looks like an email.
    if (identifier.includes('@')) {
      const admin = await one(
        'SELECT id, password_hash, password_salt FROM accountants WHERE email = $1',
        [identifier]
      );
      if (admin && verifyPassword(password, admin.password_salt, admin.password_hash)) {
        return send(res, 200, {
          id: admin.id, email: identifier, role: 'admin',
        }, { 'Set-Cookie': authCookies(admin.id, { role: 'admin' }) });
      }
    }

    // Try employee by username.
    const emp = await one(
      `SELECT id, accountant_id, name, password_hash, password_salt, status
       FROM employees WHERE LOWER(username) = $1 AND password_hash IS NOT NULL`,
      [identifier]
    );
    if (emp && emp.status === 'active' && verifyPassword(password, emp.password_salt, emp.password_hash)) {
      return send(res, 200, {
        id: emp.id, name: emp.name, role: 'employee',
      }, { 'Set-Cookie': authCookies(emp.id, { role: 'employee', ownerId: emp.accountant_id }) });
    }

    throw { status: 401, message: 'invalid credentials' };
  },
});
