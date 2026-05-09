-- Collector employees don't need a primary branch.
-- (cashier still has user_branches to govern access)

ALTER TABLE employees ALTER COLUMN branch_id DROP NOT NULL;
