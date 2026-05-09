-- Main treasury: each admin owns ONE central safe (the "الخزنة الرئيسية").
-- Collectors hand over cash to it via transfers (with admin confirmation).
-- Purchases are distinguished from regular expenses for accounting.

-- 1) Allow safes without a branch (= admin-level main treasury).
ALTER TABLE safes ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE safes ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_safes_main_per_admin
  ON safes(accountant_id) WHERE is_main = TRUE;

-- 2) Auto-create the main safe for each admin who doesn't have one yet.
--    ID: 16-char hex, mimics the app's nanoid format.
INSERT INTO safes (id, branch_id, accountant_id, name, opening_balance_halalas, is_main, created_at)
SELECT
  substr(md5(random()::text || a.id || extract(epoch from now())::text), 1, 16),
  NULL,
  a.id,
  'الخزنة الرئيسية',
  0,
  TRUE,
  (extract(epoch from now()) * 1000)::bigint
FROM accountants a
WHERE NOT EXISTS (
  SELECT 1 FROM safes s WHERE s.accountant_id = a.id AND s.is_main = TRUE
);

-- 3) Distinguish expenses vs purchases in collector_expenses.
ALTER TABLE collector_expenses ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'expense';
-- 'expense'  = operating cost (fuel, food, transport, ...)
-- 'purchase' = something bought (supplies, equipment, ...)

-- 4) Collector → admin transfers. Pending until admin confirms or rejects.
CREATE TABLE IF NOT EXISTS collector_transfers (
  id              TEXT PRIMARY KEY,
  collector_id    TEXT NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  accountant_id   TEXT NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
  main_safe_id    TEXT NOT NULL REFERENCES safes(id)       ON DELETE CASCADE,
  amount_halalas  BIGINT NOT NULL CHECK (amount_halalas > 0),
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'confirmed' | 'rejected'
  reject_reason   TEXT,
  submitted_at    BIGINT NOT NULL,
  reviewed_at     BIGINT
);
CREATE INDEX IF NOT EXISTS idx_transfers_collector  ON collector_transfers(collector_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_accountant ON collector_transfers(accountant_id, status, submitted_at DESC);
