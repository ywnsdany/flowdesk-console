-- Add a "collector" role: a person who picks up cash from branches and
-- spends from a personal wallet. Lives in the employees table for shared auth.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'cashier';
-- 'cashier' = closes daily shifts (existing behavior)
-- 'collector' = collects cash from branches + records expenses

-- Collections: cash picked up from a branch's safe.
-- Atomic with cash_movements + collector_movements at the API layer.
CREATE TABLE IF NOT EXISTS collections (
  id                  TEXT PRIMARY KEY,
  collector_id        TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  accountant_id       TEXT NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
  branch_id           TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  safe_id             TEXT NOT NULL REFERENCES safes(id) ON DELETE CASCADE,
  amount_halalas      BIGINT NOT NULL CHECK (amount_halalas > 0),
  collected_at        BIGINT NOT NULL,
  note                TEXT,
  receipt_storage_key TEXT,
  created_at          BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_collector  ON collections(collector_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_safe       ON collections(safe_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_accountant ON collections(accountant_id, collected_at DESC);

-- Collector expenses (deductions from wallet for fuel, food, repairs, etc.).
CREATE TABLE IF NOT EXISTS collector_expenses (
  id                  TEXT PRIMARY KEY,
  collector_id        TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  accountant_id       TEXT NOT NULL REFERENCES accountants(id) ON DELETE CASCADE,
  amount_halalas      BIGINT NOT NULL CHECK (amount_halalas > 0),
  category            TEXT NOT NULL DEFAULT 'other',
  -- 'fuel' | 'food' | 'maintenance' | 'transfer_to_admin' | 'other'
  place               TEXT, -- where it was spent
  reason              TEXT, -- what / why
  spent_at            BIGINT NOT NULL,
  receipt_storage_key TEXT,
  created_at          BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collector_expenses_collector  ON collector_expenses(collector_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS idx_collector_expenses_accountant ON collector_expenses(accountant_id, spent_at DESC);

-- Collector wallet ledger. Source of truth for balance:
--   balance = (last row's balance_after_halalas) for that collector.
-- Types:
--   'collection' (+) — picked up from a branch
--   'expense'    (-) — spent
--   'deposit'    (-) — handed over to admin / deposited (future)
--   'adjustment' (±) — manual admin adjustment
CREATE TABLE IF NOT EXISTS collector_movements (
  id                       TEXT PRIMARY KEY,
  collector_id             TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type                     TEXT NOT NULL,
  ref_id                   TEXT,
  amount_halalas           BIGINT NOT NULL, -- positive = in, negative = out
  balance_after_halalas    BIGINT NOT NULL,
  created_at               BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collector_movements_collector
  ON collector_movements(collector_id, created_at DESC);
