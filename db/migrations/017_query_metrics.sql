CREATE TABLE IF NOT EXISTS query_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,                          -- nullable (some queries are system-level)
  query_fingerprint VARCHAR(64) NOT NULL, -- SHA-256 of normalized query template
  query_template TEXT NOT NULL,           -- query with $1/$2 placeholders (no values)
  execution_ms INT NOT NULL,
  rows_scanned INT,
  rows_returned INT NOT NULL,
  sequential_scan BOOLEAN DEFAULT false,
  index_used VARCHAR(200),
  explain_plan TEXT,                      -- only for slow queries
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_metrics_fingerprint ON query_metrics(query_fingerprint);
CREATE INDEX IF NOT EXISTS idx_query_metrics_slow ON query_metrics(execution_ms) WHERE execution_ms > 100;
CREATE INDEX IF NOT EXISTS idx_query_metrics_recorded ON query_metrics(recorded_at);
