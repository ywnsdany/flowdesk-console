import { requireAccountant, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn } from '../db.js';
import { newId } from '../ids.js';
import { readJson, send } from '../router.js';

const TYPES = new Set(['restaurant', 'cafe', 'shop']);

export function mountBrands(router) {
  router.GET('/api/brands', async (req, res) => {
    const me = requireAccountant(req);
    const rows = getDb()
      .prepare('SELECT id, name, type, created_at FROM brands WHERE accountant_id = ? ORDER BY created_at DESC')
      .all(me.id);
    send(res, 200, { items: rows });
  });

  router.POST('/api/brands', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const type = String(body.type || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    if (!TYPES.has(type)) throw { status: 400, message: 'invalid type' };
    const id = newId();
    getDb().prepare('INSERT INTO brands (id, accountant_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, me.id, name, type, Date.now());
    audit(me.id, 'create', 'brand', id, null, { name, type });
    send(res, 200, { id, name, type });
  });

  router.PATCH('/api/brands/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('brands', id, me.id);
    const body = await readJson(req);
    const before = getDb().prepare('SELECT name, type FROM brands WHERE id = ?').get(id);
    const name = body.name != null ? String(body.name).trim() : before.name;
    const type = body.type != null ? String(body.type).trim() : before.type;
    if (!name) throw { status: 400, message: 'name is required' };
    if (!TYPES.has(type)) throw { status: 400, message: 'invalid type' };
    getDb().prepare('UPDATE brands SET name = ?, type = ? WHERE id = ?').run(name, type, id);
    audit(me.id, 'update', 'brand', id, before, { name, type });
    send(res, 200, { id, name, type });
  });

  router.DELETE('/api/brands/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('brands', id, me.id);
    const before = getDb().prepare('SELECT name, type FROM brands WHERE id = ?').get(id);
    getDb().prepare('DELETE FROM brands WHERE id = ?').run(id);
    audit(me.id, 'delete', 'brand', id, before, null);
    send(res, 200, { ok: true });
  });
}
