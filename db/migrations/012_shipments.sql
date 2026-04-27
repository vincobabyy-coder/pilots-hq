CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_number VARCHAR(50) NOT NULL,
  origin_warehouse_id UUID REFERENCES warehouses(id),
  destination_address JSONB NOT NULL,
  dest_lat DECIMAL(10,7),
  dest_lon DECIMAL(10,7),
  status VARCHAR(50) DEFAULT 'created',
  assigned_route_id UUID REFERENCES routes(id),
  assigned_driver_id UUID REFERENCES drivers(id),
  estimated_delivery TIMESTAMP,
  actual_delivery TIMESTAMP,
  exception_flag BOOLEAN DEFAULT false,
  exception_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, shipment_number)
);
CREATE INDEX IF NOT EXISTS idx_shipments_org_status ON shipments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_driver ON shipments(assigned_driver_id);
