import { handler, send } from './_lib/http.js';

export default handler({
  GET: async (req, res) => send(res, 200, { ok: true, time: Date.now() }),
});
