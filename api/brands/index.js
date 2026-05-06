import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { query } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { handler, readJson, send } from '../_lib/http.js';

const TYPES = new Set(['restaurant', 'cafe', 'shop']);

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const rows = await query(
      'SELECT id, name, type, created_at FROM brands WHERE accountant_id = $1 ORDER BY created_at DESC',
      [me.id]
    );
    send(res, 200, { items: rows });
  },

  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const type = String(body.type || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    if (!TYPES.has(type)) throw { status: 400, message: 'invalid type' };
    const id = newId();
    await query(
      'INSERT INTO brands (id, accountant_id, name, type, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, me.id, name, type, Date.now()]
    );
    await audit(me.id, 'create', 'brand', id, null, { name, type });
    send(res, 200, { id, name, type });
  },
});
