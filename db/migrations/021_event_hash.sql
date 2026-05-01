ALTER TABLE tracking_events ADD COLUMN IF NOT EXISTS event_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_tracking_events_hash ON tracking_events(event_hash) WHERE event_hash IS NOT NULL;
