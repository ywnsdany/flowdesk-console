import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { one, query, requireOwn } from '../_lib/db.js';
import { handler, readJson, send } from '../_lib/http.js';

const TYPES = new Set(['restaurant', 'cafe', 'shop']);

export default handler({
  PATCH: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('brands', id, me.id);
    const body = await readJson(req);
    const before = await one('SELECT name, type FROM brands WHERE id = $1', [id]);
    const name = body.name != null ? String(body.name).trim() : before.name;
    const type = body.type != null ? String(body.type).trim() : before.type;
    if (!name) throw { status: 400, message: 'name is required' };
    if (!TYPES.has(type)) throw { status: 400, message: 'invalid type' };
    await query('UPDATE brands SET name = $1, type = $2 WHERE id = $3', [name, type, id]);
    await audit(me.id, 'update', 'brand', id, before, { name, type });
    send(res, 200, { id, name, type });
  },

  DELETE: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('brands', id, me.id);
    const before = await one('SELECT name, type FROM brands WHERE id = $1', [id]);
    await query('DELETE FROM brands WHERE id = $1', [id]);
    await audit(me.id, 'delete', 'brand', id, before, null);
    send(res, 200, { ok: true });
  },
});
