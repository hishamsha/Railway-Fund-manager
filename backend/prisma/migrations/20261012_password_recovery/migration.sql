ALTER TABLE app.app_users
  ADD COLUMN password_reset_hash TEXT,
  ADD COLUMN password_reset_expires_at TIMESTAMPTZ;
