-- Widen password_hash to TEXT to accommodate full salt:hash format
ALTER TABLE users ALTER COLUMN password_hash TYPE TEXT;
