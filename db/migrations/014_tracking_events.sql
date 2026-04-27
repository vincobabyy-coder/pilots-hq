CREATE TABLE IF NOT EXISTS tracking_events (
  id UUID DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  event_status VARCHAR(100),
  lat DECIMAL(10,7),
  lon DECIMAL(10,7),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
);
CREATE INDEX IF NOT EXISTS idx_tracking_shipment_time ON tracking_events(shipment_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('tracking_events', 'created_at', if_not_exists => TRUE);
  END IF;
END $$;
