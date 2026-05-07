// Authenticated employee uploads a single photo. Returns storage key + meta.
import { requireEmployee } from '../_lib/auth.js';
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

export default handler({
  POST: async (req, res) => {
    const me = requireEmployee(req);
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
    const storageKey = `pending/emp_${me.id}/${fileId}.${ext}`;
    await uploadBytes(storageKey, filePart.data, { contentType: mime });
    send(res, 200, { storage_key: storageKey, kind, mime, size: filePart.data.length });
  },
});
