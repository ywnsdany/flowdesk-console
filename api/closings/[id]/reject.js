import { requireAccountant, requireCsrf } from '../../_lib/auth.js';
import { audit } from '../../_lib/audit.js';
import { one, query, requireOwn } from '../../_lib/db.js';
import { handler, readJson, send } from '../../_lib/http.js';
import { deleteKey } from '../../_lib/blob.js';

export default handler({
  POST: async (req, res) => {
    const me = requireAccountant(req);
    requireCsrf(req, me);
    const id = String(req.query.id);
    await requireOwn('closings', id, me.id);
    const body = await readJson(req);
    const reason = String(body.reason || '').trim();
    if (!reason) throw { status: 400, message: 'reason is required' };

    const c = await one('SELECT status FROM closings WHERE id = $1', [id]);
    if (c.status !== 'pending') throw { status: 400, message: 'closing is not pending' };

    const atts = await query('SELECT id, storage_key FROM attachments WHERE closing_id = $1', [id]);
    await query(
      'UPDATE closings SET status = $1, reject_reason = $2, reviewed_at = $3 WHERE id = $4',
      ['rejected', reason, Date.now(), id]
    );

    // Best-effort: delete pending blob files.
    for (const a of atts) {
      if (a.storage_key && a.storage_key.startsWith('pending/')) {
        try { await deleteKey(a.storage_key); } catch {}
      }
    }

    await audit(me.id, 'reject', 'closing', id, { status: 'pending' }, { status: 'rejected', reason });
    send(res, 200, { ok: true });
  },
});
