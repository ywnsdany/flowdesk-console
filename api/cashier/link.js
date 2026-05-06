import { one } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const linkId = String(req.query.l || '');
    const token = String(req.query.t || '');
    if (!linkId || !token) throw { status: 400, message: 'missing link or token' };
    const link = await one(
      `SELECT l.id, l.token, l.status, l.branch_id, l.safe_id, l.employee_id,
              br.name AS brand_name, b.name AS branch_name, s.name AS safe_name, e.name AS employee_name
       FROM cashier_links l
       JOIN branches b ON b.id = l.branch_id
       JOIN brands br ON br.id = b.brand_id
       JOIN safes s ON s.id = l.safe_id
       LEFT JOIN employees e ON e.id = l.employee_id
       WHERE l.id = $1 AND l.token = $2`,
      [linkId, token]
    );
    if (!link || link.status !== 'active') throw { status: 404, message: 'invalid link' };
    const settings = (await one('SELECT * FROM branch_settings WHERE branch_id = $1', [link.branch_id])) || {
      enable_apps_sales: 1,
      require_foodics_img: 1, require_network_img: 1, require_apps_img: 1, require_cash_img: 1, require_custody_receipt_img: 1,
    };
    send(res, 200, {
      link: {
        id: link.id,
        brand_name: link.brand_name,
        branch_name: link.branch_name,
        safe_name: link.safe_name,
        employee_name: link.employee_name,
      },
      settings: {
        enable_apps_sales: !!settings.enable_apps_sales,
        require_foodics_img: !!settings.require_foodics_img,
        require_network_img: !!settings.require_network_img,
        require_apps_img: !!settings.require_apps_img,
        require_cash_img: !!settings.require_cash_img,
        require_custody_receipt_img: !!settings.require_custody_receipt_img,
      },
    });
  },
});
