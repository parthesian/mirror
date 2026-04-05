CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    storage_key TEXT NOT NULL UNIQUE,
    location TEXT NOT NULL,
    description TEXT DEFAULT '',
    taken_at TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    width INTEGER,
    height INTEGER
);

CREATE INDEX IF NOT EXISTS idx_photos_taken_at_id
ON photos (taken_at DESC, id DESC);
