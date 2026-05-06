import { signJwt, verifyPin } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { checkPinRateLimit, recordPinAttempt } from '../_lib/pin.js';
import { getClientIp, handler, readJson, send } from '../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    const ip = getClientIp(req);
    const body = await readJson(req);
    const linkId = String(body.link_id || '');
    const token = String(body.token || '');
    const pin = String(body.pin || '');
    if (!linkId || !token || !/^\d{4,8}$/.test(pin)) throw { status: 400, message: 'invalid input' };
    const link = await one(
      'SELECT id, token, pin_hash, pin_salt, pin_version, status FROM cashier_links WHERE id = $1',
      [linkId]
    );
    if (!link || link.token !== token || link.status !== 'active') throw { status: 404, message: 'invalid link' };
    await checkPinRateLimit(linkId, ip);
    const ok = verifyPin(pin, link.pin_salt, link.pin_hash);
    await recordPinAttempt(linkId, ip, ok);
    if (!ok) throw { status: 401, message: 'PIN غير صحيح' };
    const jwt = signJwt({ scope: 'cashier', link_id: linkId, pin_version: link.pin_version }, 30 * 60);
    send(res, 200, { token: jwt, expires_in: 30 * 60 });
  },
});
