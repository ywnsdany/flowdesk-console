// Simple local filesystem storage.
// Files live under UPLOAD_DIR (defaults to ./data/uploads).

import { writeFileSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'data', 'uploads');

function abs(pathname) { return join(UPLOAD_DIR, pathname); }
function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }

export async function uploadBytes(pathname, body, _meta = {}) {
  const fp = abs(pathname);
  ensureDir(fp);
  writeFileSync(fp, body);
  return { pathname };
}

// Move a file (used to promote pending → confirmed).
export async function moveKey(fromKey, toKey) {
  const from = abs(fromKey);
  const to = abs(toKey);
  if (!existsSync(from)) return null;
  ensureDir(to);
  renameSync(from, to);
  return { pathname: toKey };
}

export async function deleteKey(pathname) {
  const fp = abs(pathname);
  if (existsSync(fp)) {
    try { unlinkSync(fp); } catch {}
  }
}

// Compatibility shim for old call sites; always returns null in local mode
// so callers fall through to streaming via localPath().
export async function urlOf(_pathname) { return null; }
export function isLocalMode() { return true; }
export function localPath(pathname) { return abs(pathname); }
