-- Collection intake v1. Safe to re-run pieces; CREATE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  seller_email TEXT NOT NULL,
  paypal_gs_email TEXT NOT NULL,
  instagram TEXT,
  accepted_terms_at TEXT NOT NULL,
  cover_photo_id TEXT,
  overlay_url TEXT,
  harness_total_cents INTEGER,
  offer_cents INTEGER,
  offer_sent_at TEXT,
  offer_expires_at TEXT,
  offer_token TEXT UNIQUE,
  internal_note TEXT,
  decline_reason TEXT,
  decline_wanted_cents INTEGER,
  decline_detail TEXT,
  tracking TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_status ON collections(status);
CREATE INDEX IF NOT EXISTS idx_collections_email ON collections(seller_email);
CREATE INDEX IF NOT EXISTS idx_collections_token ON collections(offer_token);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'original',
  r2_key TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  moderation_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id)
);

CREATE INDEX IF NOT EXISTS idx_photos_collection ON photos(collection_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  collection_id TEXT,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_collection ON events(collection_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Rejected images are NEVER stored. This table is identity + reason codes only.
CREATE TABLE IF NOT EXISTS moderation_alerts (
  id TEXT PRIMARY KEY,
  seller_name TEXT,
  seller_email TEXT,
  paypal_gs_email TEXT,
  reason_codes TEXT NOT NULL,
  attempted_photo_count INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  seller_name TEXT NOT NULL,
  seller_email TEXT NOT NULL,
  paypal_gs_email TEXT NOT NULL,
  instagram TEXT,
  accepted_terms_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_temp_photos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES upload_sessions(id)
);
