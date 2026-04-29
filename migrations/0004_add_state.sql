-- Run in the D1 console (or via wrangler) after previous migrations.
-- Adds optional state / province / region metadata for location filtering.

ALTER TABLE photos ADD COLUMN state TEXT DEFAULT '';
