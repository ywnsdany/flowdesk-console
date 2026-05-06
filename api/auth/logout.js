import { clearAuthCookies } from '../_lib/auth.js';
import { handler, send } from '../_lib/http.js';

export default handler({
  POST: async (req, res) => {
    send(res, 200, { ok: true }, { 'Set-Cookie': clearAuthCookies() });
  },
});
