-- Run in the D1 console (or via wrangler) after previous migrations.
-- Adds optional camera / device name used when the photo was taken (e.g. EXIF Model or manual label).

ALTER TABLE photos ADD COLUMN camera TEXT DEFAULT '';
