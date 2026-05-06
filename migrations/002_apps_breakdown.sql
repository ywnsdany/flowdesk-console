-- Per-branch toggle for the apps-sales section (delivery apps).
-- When 0, the cashier UI hides the apps section and the closing accepts no per-app values.
ALTER TABLE branch_settings ADD COLUMN enable_apps_sales INTEGER NOT NULL DEFAULT 1;

-- Whether the foodics invoice screenshot is required.
ALTER TABLE branch_settings ADD COLUMN require_foodics_img INTEGER NOT NULL DEFAULT 1;

-- Per-app sales breakdown on each closing.
-- total apps_sales_halalas is the sum (still stored on closings as before).
ALTER TABLE closings ADD COLUMN keeta_halalas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closings ADD COLUMN hungerstation_halalas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closings ADD COLUMN jahez_halalas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE closings ADD COLUMN ninja_halalas INTEGER NOT NULL DEFAULT 0;
