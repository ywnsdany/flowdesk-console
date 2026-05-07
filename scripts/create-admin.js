#!/usr/bin/env node
// Seed an admin (accountant) account.
//
// Usage:
//   DATABASE_URL=... node scripts/create-admin.js <username> <password> [email]
// Or interactively:
//   DATABASE_URL=... node scripts/create-admin.js
//
// Existing admin with same username → password gets reset.

import pg from 'pg';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64');
  const hash = pbkdf2Sync(password, salt, 310_000, 32, 'sha256').toString('base64');
  return { salt, hash };
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function newId(len = 16) {
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}

async function ask(rl, q, hidden = false) {
  if (!hidden) return (await rl.question(q)).trim();
  return new Promise((resolve) => {
    process.stdout.write(q);
    process.stdin.setRawMode?.(true);
    let val = '';
    function onData(ch) {
      ch = ch.toString('utf8');
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(val);
      } else if (ch === '') { process.exit(); }
      else if (ch === '') { val = val.slice(0, -1); }
      else { val += ch; process.stdout.write('*'); }
    }
    process.stdin.on('data', onData);
  });
}

let username = process.argv[2];
let password = process.argv[3];
const email = process.argv[4] || null;

if (!username || !password) {
  const rl = readline.createInterface({ input, output });
  if (!username) username = await ask(rl, 'Username: ');
  if (!password) password = await ask(rl, 'Password: ', true);
  rl.close();
}

username = username.trim().toLowerCase();
if (!/^[a-z0-9_.-]{3,32}$/i.test(username)) {
  console.error('Invalid username (3–32 chars, a-z/0-9/_-.)');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 chars');
  process.exit(1);
}

const ssl = /sslmode=require/.test(url) || /\.neon\.tech|amazonaws\.com/.test(url)
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({ connectionString: url, ssl });
try {
  const { salt, hash } = hashPassword(password);
  const existing = await pool.query(
    'SELECT id FROM accountants WHERE LOWER(username) = $1',
    [username]
  );

  if (existing.rows[0]) {
    await pool.query(
      'UPDATE accountants SET password_hash = $1, password_salt = $2 WHERE id = $3',
      [hash, salt, existing.rows[0].id]
    );
    console.log(`✓ Admin "${username}" — password updated.`);
  } else {
    const id = newId();
    await pool.query(
      `INSERT INTO accountants (id, username, email, password_hash, password_salt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, username, email, hash, salt, Date.now()]
    );
    console.log(`✓ Admin "${username}" created.`);
  }
} finally {
  await pool.end();
}
