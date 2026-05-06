// Minimal multipart/form-data parser (RFC 7578).
// Reads the raw stream, splits by boundary.
// On Vercel: requires `export const config = { api: { bodyParser: false } }` on the handler.

export async function readRawBody(req, maxBytes = 10 * 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject({ status: 413, message: 'payload too large' });
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parseMultipart(req, maxBytes = 10 * 1024 * 1024) {
  const ct = req.headers['content-type'] || '';
  const m = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(ct);
  if (!m) throw { status: 400, message: 'expected multipart/form-data' };
  const boundary = m[1] || m[2];
  const buf = await readRawBody(req, maxBytes);
  return splitParts(buf, '--' + boundary);
}

function splitParts(buf, boundary) {
  const parts = [];
  const dash = Buffer.from(boundary, 'utf8');
  const crlf = Buffer.from('\r\n', 'utf8');
  let start = buf.indexOf(dash, 0);
  if (start === -1) return parts;
  start += dash.length;
  while (start < buf.length) {
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const headersEnd = buf.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headersEnd === -1) break;
    const rawHeaders = buf.slice(start, headersEnd).toString('utf8');
    const dataStart = headersEnd + 4;
    const nextBoundary = buf.indexOf(Buffer.concat([crlf, dash]), dataStart);
    if (nextBoundary === -1) break;
    const data = buf.slice(dataStart, nextBoundary);
    const headers = parseHeaders(rawHeaders);
    const cd = parseContentDisposition(headers['content-disposition'] || '');
    parts.push({
      name: cd.name,
      filename: cd.filename,
      contentType: headers['content-type'],
      data,
    });
    start = nextBoundary + crlf.length + dash.length;
  }
  return parts;
}

function parseHeaders(raw) {
  const out = {};
  for (const line of raw.split('\r\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).toLowerCase().trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function parseContentDisposition(s) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^;]*))/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return out;
}
