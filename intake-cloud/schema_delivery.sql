-- Delivery choice from the landing form: ship_us | dropoff_florida
ALTER TABLE collections ADD COLUMN delivery_method TEXT;
ALTER TABLE upload_sessions ADD COLUMN delivery_method TEXT;
