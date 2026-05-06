// Vercel Blob wrapper for upload/delete/url helpers.
// Uses @vercel/blob package. Tokens come from BLOB_READ_WRITE_TOKEN env var (auto-injected on Vercel).

import { put, del, head } from '@vercel/blob';

// Upload bytes to a path. Returns { url, pathname }.
export async function uploadBytes(pathname, body, { contentType }) {
  const result = await put(pathname, body, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { url: result.url, pathname: result.pathname };
}

// Move (copy + delete). Used to promote pending → confirmed.
// On Vercel Blob, the underlying API doesn't have a native rename; we re-upload.
export async function moveKey(fromKey, toKey) {
  const meta = await head(fromKey).catch(() => null);
  if (!meta) return null;
  // Fetch source bytes.
  const res = await fetch(meta.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const result = await uploadBytes(toKey, buf, { contentType: meta.contentType });
  await del(fromKey);
  return result;
}

export async function deleteKey(pathname) {
  try { await del(pathname); } catch {}
}

// Public URL of a stored object. Returns null if not found.
export async function urlOf(pathname) {
  try {
    const meta = await head(pathname);
    return meta?.url || null;
  } catch {
    return null;
  }
}
