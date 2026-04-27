CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_number VARCHAR(50) NOT NULL,
  origin_address JSONB NOT NULL,
  destination_address JSONB NOT NULL,
  dest_lat DECIMAL(10,7),
  dest_lon DECIMAL(10,7),
  items JSONB NOT NULL,
  total_weight_kg DECIMAL(10,2),
  total_volume_cbm DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'pending',
  allocated_warehouse_id UUID REFERENCES warehouses(id),
  scheduled_delivery_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, order_number)
);
CREATE INDEX IF NOT EXISTS idx_orders_org_status ON orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
