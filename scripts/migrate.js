#!/usr/bin/env node
// One-shot Postgres migration runner. Usage:
//   DATABASE_URL=postgresql://... node scripts/migrate.js

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const ssl = /sslmode=require/.test(url) || /\.neon\.tech|amazonaws\.com/.test(url)
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({ connectionString: url, ssl });
const client = await pool.connect();

try {
  await client.query(`CREATE TABLE IF NOT EXISTS migrations_applied (
    filename TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`);

  const dir = join(ROOT, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.postgres.sql')).sort();
  const { rows: appliedRows } = await client.query('SELECT filename FROM migrations_applied');
  const applied = new Set(appliedRows.map((r) => r.filename));

  let count = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`[skip]  ${f}`);
      continue;
    }
    const sqlText = readFileSync(join(dir, f), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sqlText);
      await client.query(
        'INSERT INTO migrations_applied (filename, applied_at) VALUES ($1, $2)',
        [f, Date.now()]
      );
      await client.query('COMMIT');
      console.log(`[apply] ${f}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  console.log(`Done. ${count} migration(s) applied.`);
} finally {
  client.release();
  await pool.end();
}
