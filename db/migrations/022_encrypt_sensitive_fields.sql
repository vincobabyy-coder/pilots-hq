-- Migration 022: Restructure organizations table for encrypted field storage.
-- The actual row-by-row encryption is performed at application startup by
-- migrateEncryptFields() in core/crypto/field-encryption.ts because
-- PostgreSQL cannot call Node.js crypto functions directly.

-- Rename existing plaintext columns so the app can still read them during migration.
ALTER TABLE organizations RENAME COLUMN api_key TO api_key_plaintext;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS api_key_encrypted VARCHAR(700);

-- webhook_secret_encrypted was named as if encrypted but held plaintext.
ALTER TABLE organizations RENAME COLUMN webhook_secret_encrypted TO webhook_secret_plaintext;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS webhook_secret_encrypted_v2 VARCHAR(700);
