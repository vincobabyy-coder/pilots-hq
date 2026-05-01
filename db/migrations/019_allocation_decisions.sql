CREATE TABLE IF NOT EXISTS allocation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  order_id UUID NOT NULL,
  assigned_warehouse_id UUID NOT NULL,
  assigned_score DECIMAL(10,4) NOT NULL,
  runner_up_warehouse_id UUID,
  runner_up_score DECIMAL(10,4),
  score_gap DECIMAL(10,4),
  reasoning JSONB NOT NULL DEFAULT '[]',    -- AllocationFactor[]
  alternatives JSONB NOT NULL DEFAULT '[]', -- AllocationAlternative[]
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_allocation_decisions_order ON allocation_decisions(order_id);
CREATE INDEX IF NOT EXISTS idx_allocation_decisions_org ON allocation_decisions(org_id);
