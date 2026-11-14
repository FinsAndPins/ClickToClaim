-- Progressive cloud intake: draft collections get photos while the seller fills the form.
ALTER TABLE upload_sessions ADD COLUMN early_detect_due_ms INTEGER;
