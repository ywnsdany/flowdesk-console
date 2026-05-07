// node-postgres driver. Works with any Postgres (local, Neon, RDS, etc.).
// Reads DATABASE_URL from env. Uses a single shared Pool across the process.

import pg from 'pg';

const { Pool } = pg;

let _pool = null;

function url() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL is not set');
  return u;
}

function getPool() {
  if (_pool) return _pool;
  const connectionString = url();
  // Auto-detect SSL: Neon/Hosted typically need it; localhost doesn't.
  const ssl = /sslmode=require/.test(connectionString) || /\.neon\.tech|amazonaws\.com|rds\.amazonaws\.com/.test(connectionString)
    ? { rejectUnauthorized: false }
    : false;
  _pool = new Pool({
    connectionString,
    ssl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

// Single parameterized query. Returns rows.
export async function query(text, params = []) {
  const r = await getPool().query(text, params);
  return r.rows;
}

// First row or null.
export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// Run a callback inside a transaction, with a dedicated client.
// Usage: await tx(async (q) => { const r = await q('INSERT ...', [a, b]); ... })
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const q = async (text, params) => (await client.query(text, params)).rows;
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// Throws 404/403 if a row in `table` with id `id` doesn't belong to `accountantId`.
export async function requireOwn(table, id, accountantId) {
  const row = await one(`SELECT accountant_id FROM ${table} WHERE id = $1`, [id]);
  if (!row) throw { status: 404, message: 'not found' };
  if (row.accountant_id !== accountantId) throw { status: 403, message: 'forbidden' };
}
