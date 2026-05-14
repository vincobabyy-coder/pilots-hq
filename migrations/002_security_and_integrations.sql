-- Migration: Security tables and third-party integrations
-- Purpose: Support hardened authentication, token rotation, audit logging, and third-party service integrations

-- Refresh tokens for auth rotation
CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id (user_id),
  INDEX idx_expires_at (expires_at)
);

-- Password reset tokens
CREATE TABLE password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Login attempt tracking (brute force protection)
CREATE TABLE login_attempts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  ip VARCHAR(45),
  reason VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),

  INDEX idx_email (email),
  INDEX idx_created_at (created_at)
);

-- SMS logs for audit trail
CREATE TABLE sms_logs (
  id SERIAL PRIMARY KEY,
  org_id VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'sent',
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_org_id (org_id),
  INDEX idx_phone (phone_number),
  INDEX idx_created_at (created_at)
);

-- Shopify integration credentials
CREATE TABLE shopify_integrations (
  id SERIAL PRIMARY KEY,
  org_id VARCHAR(255) NOT NULL UNIQUE,
  shop VARCHAR(255) NOT NULL,
  access_token_encrypted VARCHAR(1024) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP,

  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_org_id (org_id)
);

-- Stripe customers
CREATE TABLE stripe_customers (
  id SERIAL PRIMARY KEY,
  org_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_stripe_id (stripe_customer_id)
);

-- Stripe subscriptions
CREATE TABLE stripe_subscriptions (
  id SERIAL PRIMARY KEY,
  org_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(255) NOT NULL,
  tier VARCHAR(50),
  status VARCHAR(20),
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_customer FOREIGN KEY (stripe_customer_id) REFERENCES stripe_customers(stripe_customer_id),
  INDEX idx_org_id (org_id),
  INDEX idx_status (status)
);

-- Payment failure tracking
CREATE TABLE payment_failures (
  id SERIAL PRIMARY KEY,
  org_id VARCHAR(255) NOT NULL UNIQUE,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_org_id (org_id)
);

-- Audit log for data access and modifications (immutable)
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  org_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(100),
  resource_id VARCHAR(255),
  changes_encrypted VARCHAR(2048),
  ip_address VARCHAR(45),
  user_agent VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  INDEX idx_org_id (org_id),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  INDEX idx_resource (resource_type, resource_id)
);

-- Encryption key versions (for key rotation tracking)
CREATE TABLE encryption_keys (
  id SERIAL PRIMARY KEY,
  key_version INT NOT NULL,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  algorithm VARCHAR(50) DEFAULT 'AES-256-GCM',
  current BOOLEAN DEFAULT FALSE,
  rotated_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),

  INDEX idx_current (current),
  INDEX idx_version (key_version)
);

-- Constraints to ensure data integrity
ALTER TABLE refresh_tokens ADD CONSTRAINT unique_user_refresh UNIQUE (user_id);
ALTER TABLE password_reset_tokens ADD CONSTRAINT unique_user_reset UNIQUE (user_id);

-- Indexes for performance
CREATE INDEX idx_sms_org_phone ON sms_logs(org_id, phone_number);
CREATE INDEX idx_audit_org_action ON audit_logs(org_id, action);
CREATE INDEX idx_stripe_sub_org ON stripe_subscriptions(org_id);
