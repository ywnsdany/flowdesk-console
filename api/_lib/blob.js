// Storage abstraction with two backends:
//   1. Vercel Blob (when BLOB_READ_WRITE_TOKEN is set)
//   2. Local filesystem (UPLOAD_DIR or ./data/uploads) — for VPS deployments
//
// Pick automatically based on env. Same API for both.

import {
  writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const USE_LOCAL = !process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'data', 'uploads');

let _vercelBlob = null;
async function vercelBlob() {
  if (_vercelBlob) return _vercelBlob;
  _vercelBlob = await import('@vercel/blob');
  return _vercelBlob;
}

// Upload bytes to a path. Returns { url, pathname }.
export async function uploadBytes(pathname, body, { contentType }) {
  if (USE_LOCAL) {
    const fp = join(LOCAL_DIR, pathname);
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, body);
    return { url: `local://${pathname}`, pathname };
  }
  const { put } = await vercelBlob();
  const result = await put(pathname, body, {
    access: 'public',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return { url: result.url, pathname: result.pathname };
}

// Move file from one storage key to another (e.g. pending → confirmed).
export async function moveKey(fromKey, toKey) {
  if (USE_LOCAL) {
    const from = join(LOCAL_DIR, fromKey);
    const to = join(LOCAL_DIR, toKey);
    if (!existsSync(from)) return null;
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    return { pathname: toKey };
  }
  const { put, del, head } = await vercelBlob();
  const meta = await head(fromKey).catch(() => null);
  if (!meta) return null;
  const res = await fetch(meta.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const result = await put(toKey, buf, {
    access: 'public',
    contentType: meta.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  await del(fromKey);
  return result;
}

export async function deleteKey(pathname) {
  if (USE_LOCAL) {
    const fp = join(LOCAL_DIR, pathname);
    if (existsSync(fp)) { try { unlinkSync(fp); } catch {} }
    return;
  }
  try {
    const { del } = await vercelBlob();
    await del(pathname);
  } catch {}
}

// In Blob mode, returns the public CDN URL.
// In local mode, returns null — caller should stream from disk via localPath().
export async function urlOf(pathname) {
  if (USE_LOCAL) return null;
  try {
    const { head } = await vercelBlob();
    const meta = await head(pathname);
    return meta?.url || null;
  } catch {
    return null;
  }
}

export function isLocalMode() { return USE_LOCAL; }
export function localPath(pathname) { return join(LOCAL_DIR, pathname); }
