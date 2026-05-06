import { readAccountant } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  GET: async (req, res) => {
    const me = readAccountant(req);
    if (!me) return send(res, 200, { authenticated: false });
    const row = await one('SELECT id, email FROM accountants WHERE id = $1', [me.id]);
    if (!row) return send(res, 200, { authenticated: false });
    send(res, 200, { authenticated: true, accountant: row, csrf: me.csrf });
  },
});
