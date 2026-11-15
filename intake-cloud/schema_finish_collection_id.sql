-- Link in-flight finish jobs to the collection so cron can resume after waitUntil dies.
ALTER TABLE upload_sessions ADD COLUMN collection_id TEXT;
