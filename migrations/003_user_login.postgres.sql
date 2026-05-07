-- Drop link/PIN system. Employees become loginnable users.
-- Each employee can be assigned to multiple branches via user_branches.

-- 1) Make link_id optional and break FK so we can drop cashier_links.
ALTER TABLE closings ALTER COLUMN link_id DROP NOT NULL;

-- 2) Drop the link-based auth tables entirely.
DROP TABLE IF EXISTS pin_attempts CASCADE;
DROP TABLE IF EXISTS cashier_links CASCADE;

-- 3) Add login + status columns on employees.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS username      TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_salt TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active';

-- Username unique within an admin's namespace (an admin can have ahmed01,
-- a different admin can also have ahmed01 — they don't collide).
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_username_per_admin
  ON employees(accountant_id, username)
  WHERE username IS NOT NULL;

-- 4) Many-to-many: which branches each employee can submit closings for.
CREATE TABLE IF NOT EXISTS user_branches (
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id   TEXT NOT NULL REFERENCES branches(id)  ON DELETE CASCADE,
  PRIMARY KEY (employee_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_user_branches_emp ON user_branches(employee_id);
CREATE INDEX IF NOT EXISTS idx_user_branches_br  ON user_branches(branch_id);

-- Backfill: existing employees that had branch_id → seed user_branches.
INSERT INTO user_branches (employee_id, branch_id)
SELECT id, branch_id FROM employees WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- branch_id stays on employees for backward compat / "primary branch" hint,
-- but the source-of-truth for permissions is now user_branches.

-- 5) The day this closing is FOR (independent of submission timestamp).
--    Employee picks any date within last 7 days.
ALTER TABLE closings ADD COLUMN IF NOT EXISTS closing_date BIGINT;
CREATE INDEX IF NOT EXISTS idx_closings_date ON closings(employee_id, closing_date DESC);
