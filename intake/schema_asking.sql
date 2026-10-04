-- Optional asking price from the landing form.

ALTER TABLE collections ADD COLUMN asking_cents INTEGER;
ALTER TABLE upload_sessions ADD COLUMN asking_cents INTEGER;
