-- Keep filtered gallery, timeline, and globe geo queries fast as photo volume grows.

CREATE INDEX IF NOT EXISTS idx_photos_chronology_uploaded
ON photos (taken_at DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_country_chronology
ON photos (LOWER(TRIM(country)), taken_at DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_state_chronology
ON photos (LOWER(TRIM(state)), taken_at DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_location_chronology
ON photos (LOWER(TRIM(location)), taken_at DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_country_state_chronology
ON photos (LOWER(TRIM(country)), LOWER(TRIM(state)), taken_at DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_country_state_location_chronology
ON photos (LOWER(TRIM(country)), LOWER(TRIM(state)), LOWER(TRIM(location)), taken_at DESC, uploaded_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_geo_chronology
ON photos (taken_at ASC, uploaded_at ASC, id ASC)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
