-- Claim flag so finish does not DELETE the session while temp photos still reference it.
ALTER TABLE upload_sessions ADD COLUMN finish_started_at TEXT;
