import { query } from '../../core/db/pool'

export interface MetricBaseline {
  orgId:     string
  metric:    string   // e.g. 'route_duration_minutes', 'shipment_count_per_hour'
  mean:      number
  stddev:    number
  sampleN:   number   // number of observations used
  updatedAt: string   // ISO-8601
}

// Raw DB row shape returned by the fraud_baselines table
interface BaselineRow extends Record<string, unknown> {
  org_id:     string
  metric:     string
  mean:       string
  stddev:     string
  m2:         string
  sample_n:   number
  updated_at: Date | string
}

function rowToBaseline(row: BaselineRow): MetricBaseline {
  return {
    orgId:     row.org_id,
    metric:    row.metric,
    mean:      parseFloat(row.mean),
    stddev:    parseFloat(row.stddev),
    sampleN:   row.sample_n,
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at),
  }
}

// Fetches a baseline from DB. Returns null if not found.
// Table: fraud_baselines (org_id, metric, mean, stddev, m2, sample_n, updated_at)
export async function getBaseline(
  orgId: string,
  metric: string
): Promise<MetricBaseline | null> {
  if (!orgId || !metric) {
    throw new Error('getBaseline: orgId and metric are required')
  }

  const rows = await query<BaselineRow>(
    `SELECT org_id, metric, mean, stddev, m2, sample_n, updated_at
       FROM fraud_baselines
      WHERE org_id = $1 AND metric = $2
      LIMIT 1`,
    [orgId, metric]
  )

  if (rows.length === 0) return null
  return rowToBaseline(rows[0])
}

// Upserts baseline using Welford's online algorithm for incremental mean/variance.
// If existing baseline has sampleN = 0, treats newValue as the very first observation.
// INSERT ... ON CONFLICT (org_id, metric) DO UPDATE SET ...
export async function updateBaseline(
  orgId: string,
  metric: string,
  newValue: number
): Promise<MetricBaseline> {
  if (!orgId || !metric) {
    throw new Error('updateBaseline: orgId and metric are required')
  }
  if (!Number.isFinite(newValue)) {
    throw new Error(`updateBaseline: newValue must be a finite number, got ${newValue}`)
  }

  // Fetch current state so we can apply Welford's algorithm in TypeScript.
  // We do this outside a transaction intentionally — the upsert is idempotent
  // enough for analytics purposes and avoids long-held locks.
  const rows = await query<BaselineRow>(
    `SELECT mean, stddev, m2, sample_n
       FROM fraud_baselines
      WHERE org_id = $1 AND metric = $2
      LIMIT 1`,
    [orgId, metric]
  )

  let oldMean = 0
  let oldM2   = 0
  let oldN    = 0

  if (rows.length > 0) {
    oldMean = parseFloat(rows[0].mean)
    oldM2   = parseFloat(rows[0].m2)
    oldN    = rows[0].sample_n
  }

  // Welford's online algorithm
  const newN     = oldN + 1
  const delta    = newValue - oldMean
  const newMean  = oldMean + delta / newN
  const delta2   = newValue - newMean
  const newM2    = oldM2 + delta * delta2
  // Population variance = M2 / n; stddev = sqrt(variance)
  const newVariance = newN > 1 ? newM2 / newN : 0
  const newStddev   = Math.sqrt(newVariance)

  const upserted = await query<BaselineRow>(
    `INSERT INTO fraud_baselines (org_id, metric, mean, stddev, m2, sample_n, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (org_id, metric) DO UPDATE SET
          mean       = EXCLUDED.mean,
          stddev     = EXCLUDED.stddev,
          m2         = EXCLUDED.m2,
          sample_n   = EXCLUDED.sample_n,
          updated_at = NOW()
     RETURNING org_id, metric, mean, stddev, m2, sample_n, updated_at`,
    [orgId, metric, newMean, newStddev, newM2, newN]
  )

  return rowToBaseline(upserted[0])
}

// Trains baseline from an array of historical values in one pass.
// Computes mean + population stddev, upserts to DB.
// Throws if values is empty.
export async function trainBaseline(
  orgId: string,
  metric: string,
  values: number[]
): Promise<MetricBaseline> {
  if (!orgId || !metric) {
    throw new Error('trainBaseline: orgId and metric are required')
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('trainBaseline: values must be a non-empty array')
  }
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new Error(`trainBaseline: all values must be finite numbers, got ${v}`)
    }
  }

  // Single-pass Welford's over the full array
  let mean = 0
  let m2   = 0
  const n  = values.length

  for (let i = 0; i < n; i++) {
    const x      = values[i]
    const delta  = x - mean
    mean        += delta / (i + 1)
    const delta2 = x - mean
    m2          += delta * delta2
  }

  const variance = n > 1 ? m2 / n : 0
  const stddev   = Math.sqrt(variance)

  const upserted = await query<BaselineRow>(
    `INSERT INTO fraud_baselines (org_id, metric, mean, stddev, m2, sample_n, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (org_id, metric) DO UPDATE SET
          mean       = EXCLUDED.mean,
          stddev     = EXCLUDED.stddev,
          m2         = EXCLUDED.m2,
          sample_n   = EXCLUDED.sample_n,
          updated_at = NOW()
     RETURNING org_id, metric, mean, stddev, m2, sample_n, updated_at`,
    [orgId, metric, mean, stddev, m2, n]
  )

  return rowToBaseline(upserted[0])
}
