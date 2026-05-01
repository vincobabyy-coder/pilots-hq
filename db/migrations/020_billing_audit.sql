CREATE TABLE IF NOT EXISTS billing_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  total_amount_cents BIGINT NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  inputs JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_billing_audit_org ON billing_audit(org_id);
CREATE INDEX IF NOT EXISTS idx_billing_audit_period ON billing_audit(period_start, period_end);
