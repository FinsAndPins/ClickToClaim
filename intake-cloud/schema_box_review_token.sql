-- Seller Board Box Editor link (iOS-style). Token is the auth; no staff login required.
ALTER TABLE collections ADD COLUMN box_review_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_box_review_token ON collections(box_review_token);
