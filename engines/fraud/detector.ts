import { getBaseline } from './baseline'

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export interface AnomalyResult {
  isAnomaly:  boolean
  zScore:     number
  severity:   AnomalySeverity
  metric:     string
  value:      number
  mean:       number
  stddev:     number
  detectedAt: string  // ISO-8601
}

// Thresholds (configurable, defaults shown):
//   |z| >= 2.0 → low
//   |z| >= 3.0 → medium
//   |z| >= 4.0 → high
//   |z| >= 5.0 → critical
export interface DetectorConfig {
  lowThreshold?:      number  // default 2.0
  mediumThreshold?:   number  // default 3.0
  highThreshold?:     number  // default 4.0
  criticalThreshold?: number  // default 5.0
}

const DEFAULT_CONFIG: Required<DetectorConfig> = {
  lowThreshold:      2.0,
  mediumThreshold:   3.0,
  highThreshold:     4.0,
  criticalThreshold: 5.0,
}

function resolveSeverity(
  absZ: number,
  cfg: Required<DetectorConfig>
): AnomalySeverity {
  if (absZ >= cfg.criticalThreshold) return 'critical'
  if (absZ >= cfg.highThreshold)     return 'high'
  if (absZ >= cfg.mediumThreshold)   return 'medium'
  return 'low'
}

// Computes z-score = (value - mean) / stddev.
// If baseline not found → returns { isAnomaly: false, zScore: 0, severity: 'low', ...zeros }.
// If stddev = 0: if value !== mean → treat as critical anomaly (z = Infinity → clamp to 10).
//                if value === mean → not anomaly (z = 0).
export async function detectAnomaly(
  orgId: string,
  metric: string,
  value: number,
  config?: DetectorConfig
): Promise<AnomalyResult> {
  if (!orgId || !metric) {
    throw new Error('detectAnomaly: orgId and metric are required')
  }
  if (!Number.isFinite(value)) {
    throw new Error(`detectAnomaly: value must be a finite number, got ${value}`)
  }

  const cfg: Required<DetectorConfig> = { ...DEFAULT_CONFIG, ...config }
  const detectedAt = new Date().toISOString()

  const baseline = await getBaseline(orgId, metric)

  // Baseline not found — cannot evaluate; return non-anomaly with zeroed fields
  if (baseline === null) {
    return {
      isAnomaly:  false,
      zScore:     0,
      severity:   'low',
      metric,
      value,
      mean:       0,
      stddev:     0,
      detectedAt,
    }
  }

  const { mean, stddev } = baseline

  // Handle zero stddev edge cases
  if (stddev === 0) {
    if (value === mean) {
      return {
        isAnomaly:  false,
        zScore:     0,
        severity:   'low',
        metric,
        value,
        mean,
        stddev,
        detectedAt,
      }
    }
    // value !== mean with zero stddev → critical anomaly, clamp z to 10
    return {
      isAnomaly:  true,
      zScore:     10,
      severity:   'critical',
      metric,
      value,
      mean,
      stddev,
      detectedAt,
    }
  }

  const zScore = (value - mean) / stddev
  const absZ   = Math.abs(zScore)
  const isAnomaly = absZ >= cfg.lowThreshold

  return {
    isAnomaly,
    zScore,
    severity:   resolveSeverity(absZ, cfg),
    metric,
    value,
    mean,
    stddev,
    detectedAt,
  }
}

// Batch detection — runs detectAnomaly for each metric/value pair.
// Returns only anomalies (isAnomaly = true) by default (pass returnAll=true to get all).
export async function detectAnomalies(
  orgId: string,
  observations: Array<{ metric: string; value: number }>,
  config?: DetectorConfig,
  returnAll: boolean = false
): Promise<AnomalyResult[]> {
  if (!orgId) {
    throw new Error('detectAnomalies: orgId is required')
  }
  if (!Array.isArray(observations)) {
    throw new Error('detectAnomalies: observations must be an array')
  }

  const results = await Promise.all(
    observations.map(({ metric, value }) =>
      detectAnomaly(orgId, metric, value, config)
    )
  )

  return returnAll ? results : results.filter((r) => r.isAnomaly)
}
