import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  PATCH: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('cashier_links', id, me.id);
    const body = await readJson(req);
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const before = await one('SELECT status FROM cashier_links WHERE id = $1', [id]);
    await query('UPDATE cashier_links SET status = $1 WHERE id = $2', [status, id]);
    await audit(me.id, 'update', 'cashier_link', id, before, { status });
    send(res, 200, { id, status });
  },

  DELETE: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('cashier_links', id, me.id);
    await query('DELETE FROM cashier_links WHERE id = $1', [id]);
    await audit(me.id, 'delete', 'cashier_link', id, null, null);
    send(res, 200, { ok: true });
  },
});
