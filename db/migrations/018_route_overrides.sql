CREATE TABLE IF NOT EXISTS route_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  override_type VARCHAR(50) NOT NULL,   -- 'constraint_bypass', 'manual_assignment'
  constraint_violated VARCHAR(100),
  operator_reason TEXT NOT NULL,
  operator_user_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_overrides_route ON route_overrides(route_id);
CREATE INDEX IF NOT EXISTS idx_route_overrides_org ON route_overrides(org_id);
