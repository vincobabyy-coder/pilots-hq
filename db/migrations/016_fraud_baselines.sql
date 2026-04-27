CREATE TABLE IF NOT EXISTS fraud_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  metric VARCHAR(100) NOT NULL,
  mean DECIMAL(20,6) NOT NULL DEFAULT 0,
  stddev DECIMAL(20,6) NOT NULL DEFAULT 0,
  m2 DECIMAL(20,6) NOT NULL DEFAULT 0,
  sample_n INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, metric)
);

CREATE INDEX IF NOT EXISTS idx_fraud_baselines_org_id ON fraud_baselines(org_id);
