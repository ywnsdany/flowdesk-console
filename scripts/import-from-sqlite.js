#!/usr/bin/env node
// One-shot data importer: copies rows from local data/db.sqlite into Neon.
// Optionally uploads files from data/uploads/ into Vercel Blob.
//
// Usage:
//   DATABASE_URL=postgres://...  \
//   BLOB_READ_WRITE_TOKEN=vercel_blob_... \   (optional — only if you want to copy files)
//   node scripts/import-from-sqlite.js
//
// Notes:
//   - Run scripts/migrate.js FIRST so the Postgres schema exists.
//   - The script is idempotent: ON CONFLICT DO NOTHING on every insert.
//   - Files: only attempts upload when BLOB_READ_WRITE_TOKEN is set.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { Pool } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const sqlitePath = process.env.SQLITE_PATH || join(ROOT, 'data', 'db.sqlite');
if (!existsSync(sqlitePath)) {
  console.error(`SQLite file not found: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new Pool({ connectionString: dbUrl });
const client = await pool.connect();

let blobMod = null;
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (blobToken) {
  try { blobMod = await import('@vercel/blob'); }
  catch { console.warn('@vercel/blob not installed — skipping file uploads'); }
}

// ------------------------------------------------------------------
// Plain-table copy (no special handling)
// ------------------------------------------------------------------

const TABLES = [
  { name: 'accountants',
    cols: ['id', 'email', 'password_hash', 'password_salt', 'created_at'] },
  { name: 'brands',
    cols: ['id', 'accountant_id', 'name', 'type', 'created_at'] },
  { name: 'branches',
    cols: ['id', 'brand_id', 'accountant_id', 'name', 'created_at'] },
  { name: 'branch_settings',
    cols: ['branch_id', 'enable_apps_sales', 'require_foodics_img',
           'require_network_img', 'require_apps_img', 'require_cash_img',
           'require_custody_receipt_img'],
    pk: 'branch_id' },
  { name: 'safes',
    cols: ['id', 'branch_id', 'accountant_id', 'name', 'opening_balance_halalas', 'created_at'] },
  { name: 'employees',
    cols: ['id', 'branch_id', 'accountant_id', 'name', 'custody_balance_halalas', 'created_at'] },
  { name: 'cashier_links',
    cols: ['id', 'accountant_id', 'branch_id', 'safe_id', 'employee_id',
           'token', 'pin_hash', 'pin_salt', 'pin_version', 'status', 'created_at'] },
  { name: 'closings',
    cols: ['id', 'link_id', 'accountant_id', 'branch_id', 'safe_id', 'employee_id',
           'total_sales_halalas', 'network_sales_halalas', 'apps_sales_halalas',
           'apps_invoice_count', 'cash_sales_halalas',
           'keeta_halalas', 'hungerstation_halalas', 'jahez_halalas', 'ninja_halalas',
           'cash_in_safe_halalas', 'custody_in_hand_halalas', 'custody_expense_halalas',
           'custody_expense_note',
           'opening_balance_halalas', 'expected_cash_halalas', 'variance_halalas',
           'notes', 'status', 'reject_reason', 'submitted_at', 'reviewed_at'] },
  { name: 'attachments',
    cols: ['id', 'closing_id', 'kind', 'storage_key', 'mime', 'size', 'created_at'] },
  { name: 'bank_deposits',
    cols: ['id', 'accountant_id', 'safe_id', 'amount_halalas', 'deposit_date',
           'receipt_storage_key', 'note', 'created_at'] },
  { name: 'cash_movements',
    cols: ['id', 'safe_id', 'type', 'ref_id', 'amount_halalas', 'balance_after_halalas', 'created_at'] },
  { name: 'custody_movements',
    cols: ['id', 'employee_id', 'type', 'ref_id', 'amount_halalas', 'balance_after_halalas', 'created_at'] },
];

async function copyTable({ name, cols, pk }) {
  const rows = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${name}`).all();
  if (!rows.length) {
    console.log(`[${name}] empty — skipped`);
    return;
  }
  const pkCol = pk || 'id';
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`;
  let inserted = 0;
  for (const r of rows) {
    const values = cols.map((c) => r[c] === undefined ? null : r[c]);
    const { rowCount } = await client.query(sql, values);
    inserted += rowCount;
  }
  console.log(`[${name}] copied ${inserted}/${rows.length}`);
}

// ------------------------------------------------------------------
// Run the schema migrations on Neon are expected to have been run first.
// ------------------------------------------------------------------

console.log('Importing data from', sqlitePath);
console.log('Into', dbUrl.replace(/:[^:@]+@/, ':****@'));

for (const t of TABLES) {
  try { await copyTable(t); }
  catch (err) { console.error(`[${t.name}] error:`, err.message); }
}

// ------------------------------------------------------------------
// Optional: upload files from data/uploads to Vercel Blob.
// ------------------------------------------------------------------

if (blobMod) {
  console.log('\nUploading files to Vercel Blob...');
  const uploadsDir = join(ROOT, 'data', 'uploads');
  const fileRows = [
    ...sqlite.prepare(`SELECT storage_key FROM attachments WHERE storage_key IS NOT NULL`).all(),
    ...sqlite.prepare(`SELECT receipt_storage_key AS storage_key FROM bank_deposits WHERE receipt_storage_key IS NOT NULL`).all(),
  ];
  let up = 0, missing = 0, skipped = 0;
  for (const { storage_key } of fileRows) {
    const local = join(uploadsDir, storage_key);
    if (!existsSync(local)) { missing++; continue; }
    try {
      // head() throws if not found; if found, skip.
      try {
        await blobMod.head(storage_key);
        skipped++;
        continue;
      } catch {}
      const buf = readFileSync(local);
      const ext = storage_key.split('.').pop()?.toLowerCase() || '';
      const ct = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
                    pdf: 'application/pdf' })[ext] || 'application/octet-stream';
      await blobMod.put(storage_key, buf, {
        access: 'public', contentType: ct,
        addRandomSuffix: false, allowOverwrite: true,
        token: blobToken,
      });
      up++;
    } catch (err) {
      console.error(`[blob] ${storage_key}:`, err.message);
    }
  }
  console.log(`Files: uploaded=${up} skipped=${skipped} missing-locally=${missing}`);
} else if (blobToken) {
  console.log('\nSkipping file upload (@vercel/blob not installed).');
} else {
  console.log('\nSkipping file upload (set BLOB_READ_WRITE_TOKEN to enable).');
}

await client.release();
await pool.end();
sqlite.close();
console.log('\nDone.');
