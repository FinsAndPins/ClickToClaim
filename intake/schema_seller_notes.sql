-- Optional seller notes from the contact form (AP / PP, etc.).
ALTER TABLE collections ADD COLUMN seller_notes TEXT;
ALTER TABLE upload_sessions ADD COLUMN seller_notes TEXT;
ALTER TABLE upload_sessions ADD COLUMN finish_started_at TEXT;
