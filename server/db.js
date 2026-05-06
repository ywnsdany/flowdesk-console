import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

let _db = null;

export function getDb() {
  if (_db) return _db;
  const dataDir = process.env.DATA_DIR || join(ROOT, 'data');
  mkdirSync(dataDir, { recursive: true });
  _db = new Database(join(dataDir, 'db.sqlite'));
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

export function applyMigrations() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (
    filename TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const dir = join(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    db.prepare('SELECT filename FROM migrations_applied').all().map((r) => r.filename)
  );
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    db.exec(sql);
    db.prepare('INSERT OR IGNORE INTO migrations_applied (filename, applied_at) VALUES (?, ?)').run(
      f,
      Date.now()
    );
    console.log(`[migrations] applied ${f}`);
  }
}

export function tx(fn) {
  return getDb().transaction(fn)();
}

// Throws { status: 404 } or { status: 403 } if the row does not belong to me.
export function requireOwn(table, id, accountantId) {
  const db = getDb();
  const row = db
    .prepare(`SELECT accountant_id FROM ${table} WHERE id = ?`)
    .get(id);
  if (!row) throw { status: 404, message: 'not found' };
  if (row.accountant_id !== accountantId) throw { status: 403, message: 'forbidden' };
}
