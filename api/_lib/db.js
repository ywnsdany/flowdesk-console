import { neon, neonConfig, Pool } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = true;

let _sql = null;
let _pool = null;

function url() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_URL is not set');
  return u;
}

function getSql() {
  if (_sql) return _sql;
  _sql = neon(url());
  return _sql;
}

// Run a parameterized query. Usage: await query('SELECT * FROM x WHERE id = $1', [id])
export async function query(text, params = []) {
  return await getSql()(text, params);
}

// Get one row or null.
export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// Run a callback inside a transaction with a dedicated pooled client.
// Usage: await tx(async (q) => { const r = await q('INSERT ...', [a,b]); ... })
export async function tx(fn) {
  const p = _pool || (_pool = new Pool({ connectionString: url() }));
  const client = await p.connect();
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

// Throws 404 or 403 if the row does not belong to me.
export async function requireOwn(table, id, accountantId) {
  const row = await one(`SELECT accountant_id FROM ${table} WHERE id = $1`, [id]);
  if (!row) throw { status: 404, message: 'not found' };
  if (row.accountant_id !== accountantId) throw { status: 403, message: 'forbidden' };
}
