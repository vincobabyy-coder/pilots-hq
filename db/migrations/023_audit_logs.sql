CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL,
  actor_id      UUID,
  actor_email   VARCHAR(255),
  action        VARCHAR(100) NOT NULL,
  resource      VARCHAR(100) NOT NULL,
  resource_id   VARCHAR(255),
  old_values    JSONB,
  new_values    JSONB,
  ip_address    INET,
  user_agent    TEXT,
  occurred_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org      ON audit_logs(org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor    ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource, resource_id);

-- Immutability: revoke DELETE and UPDATE so the application DB role cannot tamper with the trail.
-- Run as a superuser/migration role (not the application user).
REVOKE DELETE ON audit_logs FROM PUBLIC;
REVOKE UPDATE ON audit_logs FROM PUBLIC;
