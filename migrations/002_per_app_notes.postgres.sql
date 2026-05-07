-- Per-app notes on each closing.
-- Each delivery app (Keeta, HungerStation, Jahez, Ninja) gets its own note field.
-- Per-app photos use the attachments table with kinds: app_keeta, app_hungerstation, app_jahez, app_ninja.

ALTER TABLE closings ADD COLUMN IF NOT EXISTS keeta_note          TEXT;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS hungerstation_note  TEXT;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS jahez_note          TEXT;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS ninja_note          TEXT;
