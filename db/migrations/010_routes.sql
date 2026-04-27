CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_number VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  driver_id UUID REFERENCES drivers(id),
  vehicle_id UUID REFERENCES vehicles(id),
  status VARCHAR(50) DEFAULT 'planned',
  origin_warehouse_id UUID REFERENCES warehouses(id),
  stops JSONB NOT NULL DEFAULT '[]',
  total_distance_km DECIMAL(10,2),
  estimated_duration_minutes INT,
  actual_duration_minutes INT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, route_number, date)
);
CREATE INDEX IF NOT EXISTS idx_routes_org_date ON routes(org_id, date);
CREATE INDEX IF NOT EXISTS idx_routes_driver_date ON routes(driver_id, date);
