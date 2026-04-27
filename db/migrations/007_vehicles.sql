CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  license_plate VARCHAR(20) NOT NULL,
  type VARCHAR(50),
  capacity_kg INT,
  capacity_cbm DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'available',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, license_plate)
);
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON vehicles(org_id);
