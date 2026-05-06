import { mkdirSync, createReadStream, createWriteStream, existsSync, statSync, unlinkSync, renameSync, readdirSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

export function uploadsDir() {
  const dataDir = process.env.DATA_DIR || join(ROOT, 'data');
  const dir = join(dataDir, 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function pendingDir(linkId) {
  const dir = join(uploadsDir(), 'pending', linkId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function confirmedDir(closingId) {
  const dir = join(uploadsDir(), 'confirmed', closingId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function absPath(storageKey) {
  return join(uploadsDir(), storageKey);
}

export function streamFile(storageKey) {
  const path = absPath(storageKey);
  if (!existsSync(path)) throw { status: 404, message: 'file not found' };
  const stat = statSync(path);
  return { stream: createReadStream(path), size: stat.size };
}

export function writeStreamToKey(storageKey, mime) {
  const path = absPath(storageKey);
  mkdirSync(dirname(path), { recursive: true });
  return createWriteStream(path);
}

export function moveKey(fromKey, toKey) {
  const from = absPath(fromKey);
  const to = absPath(toKey);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

export function deleteKey(storageKey) {
  const path = absPath(storageKey);
  if (existsSync(path)) unlinkSync(path);
}

// Returns the size in bytes of `storageKey`.
export function sizeOf(storageKey) {
  return statSync(absPath(storageKey)).size;
}

// Walks pending/{linkId}/ and removes files older than `maxAgeMs`.
// Returns count of removed files.
export function cleanupPending(maxAgeMs) {
  const root = join(uploadsDir(), 'pending');
  if (!existsSync(root)) return 0;
  const now = Date.now();
  let removed = 0;
  for (const linkId of readdirSync(root)) {
    const dir = join(root, linkId);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      const fp = join(dir, file);
      const st = statSync(fp);
      if (now - st.mtimeMs > maxAgeMs) {
        unlinkSync(fp);
        removed++;
      }
    }
    if (readdirSync(dir).length === 0) {
      try { rmdirSync(dir); } catch {}
    }
  }
  return removed;
}
