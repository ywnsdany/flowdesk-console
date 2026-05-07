-- Admins log in by username (not email). Email becomes optional metadata.

ALTER TABLE accountants ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE accountants ALTER COLUMN email DROP NOT NULL;

-- Case-insensitive uniqueness on username (only when set).
CREATE UNIQUE INDEX IF NOT EXISTS uq_accountants_username
  ON accountants (LOWER(username))
  WHERE username IS NOT NULL;

-- Backfill: derive username from email prefix, with numeric suffix for dupes.
WITH ranked AS (
  SELECT id,
         SPLIT_PART(email, '@', 1) AS base,
         ROW_NUMBER() OVER (PARTITION BY LOWER(SPLIT_PART(email, '@', 1))
                            ORDER BY created_at) AS rn
  FROM accountants
  WHERE username IS NULL AND email IS NOT NULL
)
UPDATE accountants a
SET username = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || (r.rn - 1)::text END
FROM ranked r
WHERE a.id = r.id;
