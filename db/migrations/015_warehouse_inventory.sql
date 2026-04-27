CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  reserved_quantity INT NOT NULL DEFAULT 0,
  unit_cost DECIMAL(10,2),
  last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(warehouse_id, sku),
  CONSTRAINT chk_quantity_non_negative CHECK (quantity >= 0),
  CONSTRAINT chk_reserved_non_negative CHECK (reserved_quantity >= 0),
  CONSTRAINT chk_reserved_lte_quantity CHECK (reserved_quantity <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_inventory_warehouse ON warehouse_inventory(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sku ON warehouse_inventory(sku);
