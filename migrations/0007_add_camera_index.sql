-- Speed up gallery, timeline, and camera-facet queries that match a camera name.

CREATE INDEX IF NOT EXISTS idx_photos_camera_chronology
ON photos (LOWER(TRIM(camera)), taken_at DESC, uploaded_at DESC, id DESC);
