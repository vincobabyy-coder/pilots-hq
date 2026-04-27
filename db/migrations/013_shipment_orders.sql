CREATE TABLE IF NOT EXISTS shipment_orders (
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  PRIMARY KEY (shipment_id, order_id)
);
