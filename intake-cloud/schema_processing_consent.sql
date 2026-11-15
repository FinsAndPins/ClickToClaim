-- Processing consent before any board photo leaves the phone (Agree and choose photos).
-- Distinct from Submit commercial/privacy checkbox (accepted_terms_at on finish).
ALTER TABLE upload_sessions ADD COLUMN processing_consent_at TEXT;
