-- Ordered top colors for each photo, stored as a JSON array of palette ids.
-- Empty string means colors have not been computed yet (legacy rows).
-- Example: ["blue","green","white"]

ALTER TABLE photos ADD COLUMN colors TEXT DEFAULT '';
