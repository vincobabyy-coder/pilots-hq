CREATE TABLE IF NOT EXISTS speed_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hour_of_day SMALLINT NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  avg_speed_kmh DECIMAL(6,2) NOT NULL DEFAULT 40.0,
  sample_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, hour_of_day, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_speed_profiles_org ON speed_profiles(org_id);
