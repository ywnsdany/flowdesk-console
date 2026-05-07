import { verifyJwt } from '../_lib/auth.js';
import { one } from '../_lib/db.js';
import { newId } from '../_lib/ids.js';
import { parseMultipart } from '../_lib/multipart.js';
import { handler, send } from '../_lib/http.js';
import { uploadBytes } from '../_lib/blob.js';

export const config = { api: { bodyParser: false } };

const ALLOWED_KINDS = new Set([
  'foodics_invoice', 'network', 'apps', 'cash', 'custody_receipt', 'other',
  'app_keeta', 'app_hungerstation', 'app_jahez', 'app_ninja',
]);
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_UPLOAD = 8 * 1024 * 1024;

async function readScopedJwt(req, expectedLinkId) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) throw { status: 401, message: 'unauthorized' };
  const payload = verifyJwt(m[1]);
  if (!payload || payload.scope !== 'cashier' || payload.link_id !== expectedLinkId) {
    throw { status: 401, message: 'invalid session' };
  }
  const link = await one('SELECT pin_version, status FROM cashier_links WHERE id = $1', [payload.link_id]);
  if (!link || link.status !== 'active' || link.pin_version !== payload.pin_version) {
    throw { status: 401, message: 'session invalidated' };
  }
  return payload;
}

export default handler({
  POST: async (req, res) => {
    const linkId = String(req.query.l || '');
    if (!linkId) throw { status: 400, message: 'missing link' };
    await readScopedJwt(req, linkId);
    const parts = await parseMultipart(req, MAX_UPLOAD);
    const filePart = parts.find((p) => p.filename);
    const kindPart = parts.find((p) => p.name === 'kind');
    if (!filePart) throw { status: 400, message: 'no file' };
    const kind = (kindPart?.data?.toString('utf8') || 'other').trim();
    if (!ALLOWED_KINDS.has(kind)) throw { status: 400, message: 'invalid kind' };
    const mime = (filePart.contentType || '').toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) throw { status: 400, message: 'invalid file type' };
    if (filePart.data.length > MAX_UPLOAD) throw { status: 413, message: 'file too large' };

    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' })[mime] || 'bin';
    const fileId = newId();
    const storageKey = `pending/${linkId}/${fileId}.${ext}`;
    await uploadBytes(storageKey, filePart.data, { contentType: mime });
    send(res, 200, {
      storage_key: storageKey,
      kind,
      mime,
      size: filePart.data.length,
    });
  },
});
