import { requireAccountant, requireCsrf } from '../_lib/auth.js';
import { audit } from '../_lib/audit.js';
import { query, requireOwn, tx } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { handler, readJson, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const brandId = req.query.brand_id;
    const rows = brandId
      ? await query(
          `SELECT b.id, b.name, b.brand_id, b.created_at, br.name AS brand_name
           FROM branches b JOIN brands br ON br.id = b.brand_id
           WHERE b.accountant_id = $1 AND b.brand_id = $2
           ORDER BY b.created_at DESC`,
          [me.id, brandId]
        )
      : await query(
          `SELECT b.id, b.name, b.brand_id, b.created_at, br.name AS brand_name
           FROM branches b JOIN brands br ON br.id = b.brand_id
           WHERE b.accountant_id = $1
           ORDER BY b.created_at DESC`,
          [me.id]
        );
    send(res, 200, { items: rows });
  },

  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const brandId = String(body.brand_id || '').trim();
    if (!name) throw { status: 400, message: 'name is required' };
    if (!brandId) throw { status: 400, message: 'brand_id is required' };
    await requireOwn('brands', brandId, me.id);
    const id = newId();
    await tx(async (q) => {
      await q(
        'INSERT INTO branches (id, brand_id, accountant_id, name, created_at) VALUES ($1, $2, $3, $4, $5)',
        [id, brandId, me.id, name, Date.now()]
      );
      await q(
        `INSERT INTO branch_settings (branch_id, enable_apps_sales, require_foodics_img, require_network_img, require_apps_img, require_cash_img, require_custody_receipt_img)
         VALUES ($1, 1, 1, 1, 1, 1, 1)`,
        [id]
      );
    });
    await audit(me.id, 'create', 'branch', id, null, { name, brand_id: brandId });
    send(res, 200, { id, name, brand_id: brandId });
  },
});
