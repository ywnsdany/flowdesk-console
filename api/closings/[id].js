import { requireAccountant, signJwt } from '../_lib/auth.js';
import { one, query, requireOwn } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const id = String(req.query.id);
    await requireOwn('closings', id, me.id);
    const c = await one(
      `SELECT c.*, br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM closings c
       JOIN branches b ON b.id = c.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = c.safe_id
       LEFT JOIN employees e ON e.id = c.employee_id
       WHERE c.id = $1`,
      [id]
    );
    const attachments = await query(
      'SELECT id, kind, storage_key, mime, size, created_at FROM attachments WHERE closing_id = $1 ORDER BY created_at',
      [id]
    );
    const signed = attachments.map((a) => ({
      ...a,
      url: `/api/files?t=${signJwt({ k: a.storage_key, sub: me.id }, 5 * 60)}`,
    }));
    send(res, 200, { closing: c, attachments: signed });
  },
});
