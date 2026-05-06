import { hashPin, requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { query, requireOwn } from '../../_lib/db.js';
import { handler, send } from '../../_lib/http.js';

function generatePin() {
  const buf = new Uint8Array(6);
  for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 10);
  return Array.from(buf).join('');
}

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('cashier_links', id, me.id);
    const pin = generatePin();
    const { salt, hash } = hashPin(pin);
    await query(
      'UPDATE cashier_links SET pin_hash = $1, pin_salt = $2, pin_version = pin_version + 1 WHERE id = $3',
      [hash, salt, id]
    );
    await audit(me.id, 'regenerate_pin', 'cashier_link', id, null, null);
    send(res, 200, { pin });
  },
});
