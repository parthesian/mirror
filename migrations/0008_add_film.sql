-- Run in the D1 console (or via wrangler) after previous migrations.
-- Adds optional film stock used for the photo (e.g. Portra 400, Ilford HP5).

ALTER TABLE photos ADD COLUMN film TEXT DEFAULT '';
