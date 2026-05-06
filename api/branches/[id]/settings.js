import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { one, query, requireOwn } from '../../_lib/db.js';
import { handler, readJson, send } from '../../_lib/http.js';

const DEFAULT = {
  enable_apps_sales: 1,
  require_foodics_img: 1,
  require_network_img: 1,
  require_apps_img: 1,
  require_cash_img: 1,
  require_custody_receipt_img: 1,
};

export default handler({
  GET: async (req, res) => {
    const me = requireAccountant(req);
    const id = String(req.query.id);
    await requireOwn('branches', id, me.id);
    const row = await one('SELECT * FROM branch_settings WHERE branch_id = $1', [id]);
    send(res, 200, row || { branch_id: id, ...DEFAULT });
  },

  PUT: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('branches', id, me.id);
    const body = await readJson(req);
    const v = (k) => (body[k] ? 1 : 0);
    await query(
      `INSERT INTO branch_settings (branch_id, enable_apps_sales, require_foodics_img, require_network_img, require_apps_img, require_cash_img, require_custody_receipt_img)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (branch_id) DO UPDATE SET
         enable_apps_sales = EXCLUDED.enable_apps_sales,
         require_foodics_img = EXCLUDED.require_foodics_img,
         require_network_img = EXCLUDED.require_network_img,
         require_apps_img = EXCLUDED.require_apps_img,
         require_cash_img = EXCLUDED.require_cash_img,
         require_custody_receipt_img = EXCLUDED.require_custody_receipt_img`,
      [
        id,
        v('enable_apps_sales'),
        v('require_foodics_img'),
        v('require_network_img'),
        v('require_apps_img'),
        v('require_cash_img'),
        v('require_custody_receipt_img'),
      ]
    );
    await audit(me.id, 'update', 'branch_settings', id, null, body);
    send(res, 200, { ok: true });
  },
});
