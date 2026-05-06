import { requireAccountant, requireCsrf } from '../auth.js';
import { audit } from '../audit.js';
import { getDb, requireOwn, tx } from '../db.js';
import { newId } from '../ids.js';
import { readJson, send } from '../router.js';

export function mountBranches(router) {
  router.GET('/api/branches', async (req, res) => {
    const me = requireAccountant(req);
    const brandId = req.query.brand_id;
    const sql = `SELECT b.id, b.name, b.brand_id, b.created_at, br.name AS brand_name
                 FROM branches b JOIN brands br ON br.id = b.brand_id
                 WHERE b.accountant_id = ?
                 ${brandId ? 'AND b.brand_id = ?' : ''}
                 ORDER BY b.created_at DESC`;
    const rows = brandId
      ? getDb().prepare(sql).all(me.id, brandId)
      : getDb().prepare(sql).all(me.id);
    send(res, 200, { items: rows });
  });

  router.POST('/api/branches', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const brandId = String(body.brand_id || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    if (!brandId) throw { status: 400, message: 'brand_id is required' };
    requireOwn('brands', brandId, me.id);
    const id = newId();
    tx(() => {
      getDb().prepare('INSERT INTO branches (id, brand_id, accountant_id, name, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, brandId, me.id, name, Date.now());
      getDb().prepare(
        'INSERT INTO branch_settings (branch_id, require_network_img, require_apps_img, require_cash_img, require_custody_receipt_img) VALUES (?, 1, 1, 1, 1)'
      ).run(id);
    });
    audit(me.id, 'create', 'branch', id, null, { name, brand_id: brandId });
    send(res, 200, { id, name, brand_id: brandId });
  });

  router.PATCH('/api/branches/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('branches', id, me.id);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    const before = getDb().prepare('SELECT name FROM branches WHERE id = ?').get(id);
    getDb().prepare('UPDATE branches SET name = ? WHERE id = ?').run(name, id);
    audit(me.id, 'update', 'branch', id, before, { name });
    send(res, 200, { id, name });
  });

  router.DELETE('/api/branches/:id', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('branches', id, me.id);
    const before = getDb().prepare('SELECT name, brand_id FROM branches WHERE id = ?').get(id);
    getDb().prepare('DELETE FROM branches WHERE id = ?').run(id);
    audit(me.id, 'delete', 'branch', id, before, null);
    send(res, 200, { ok: true });
  });

  router.GET('/api/branches/:id/settings', async (req, res) => {
    const me = requireAccountant(req);
    const { id } = req.params;
    requireOwn('branches', id, me.id);
    const row = getDb().prepare('SELECT * FROM branch_settings WHERE branch_id = ?').get(id);
    send(res, 200, row || {
      branch_id: id,
      enable_apps_sales: 1,
      require_foodics_img: 1, require_network_img: 1, require_apps_img: 1, require_cash_img: 1, require_custody_receipt_img: 1,
    });
  });

  router.PUT('/api/branches/:id/settings', async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const { id } = req.params;
    requireOwn('branches', id, me.id);
    const body = await readJson(req);
    const v = (k) => (body[k] ? 1 : 0);
    getDb().prepare(
      `INSERT INTO branch_settings (branch_id, enable_apps_sales, require_foodics_img, require_network_img, require_apps_img, require_cash_img, require_custody_receipt_img)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         enable_apps_sales = excluded.enable_apps_sales,
         require_foodics_img = excluded.require_foodics_img,
         require_network_img = excluded.require_network_img,
         require_apps_img = excluded.require_apps_img,
         require_cash_img = excluded.require_cash_img,
         require_custody_receipt_img = excluded.require_custody_receipt_img`
    ).run(
      id,
      v('enable_apps_sales'),
      v('require_foodics_img'),
      v('require_network_img'),
      v('require_apps_img'),
      v('require_cash_img'),
      v('require_custody_receipt_img'),
    );
    audit(me.id, 'update', 'branch_settings', id, null, body);
    send(res, 200, { ok: true });
  });
}
