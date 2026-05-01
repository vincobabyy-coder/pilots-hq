import { getBaseline } from './baseline'

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export interface AnomalyResult {
  isAnomaly:          boolean
  zScore:             number
  severity:           AnomalySeverity
  metric:             string
  value:              number
  mean:               number
  stddev:             number
  detectedAt:         string  // ISO-8601
  confidence:         number  // 0.0–1.0: how confident we are this is a real anomaly
  explanation:        string  // human-readable plain English explanation
  falsePositiveRisk:  'low' | 'medium' | 'high'  // how likely this is a false positive
}

export interface GroupAnomalyResult {
  anomalies:       AnomalyResult[]  // only the anomalous ones
  groupConfidence: number           // max of individual confidences, boosted if count >= 3
  isGroupAnomaly:  boolean          // true if >= 2 anomalies detected simultaneously
  summary:         string           // "X of Y metrics are anomalous"
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

function resolveConfidence(
  absZ: number,
  sampleN: number,
  cfg: Required<DetectorConfig>
): number {
  const baseConfidence = Math.min(
    1.0,
    (absZ - cfg.lowThreshold) / (cfg.criticalThreshold - cfg.lowThreshold)
  )
  const samplePenalty = sampleN < 30 ? sampleN / 30 : 1.0
  const raw = baseConfidence * samplePenalty
  // Clamp to [0, 1] and round to 3 decimal places
  return Math.round(Math.max(0, Math.min(1.0, raw)) * 1000) / 1000
}

function resolveFalsePositiveRisk(
  absZ: number,
  sampleN: number,
  cfg: Required<DetectorConfig>
): 'low' | 'medium' | 'high' {
  if (sampleN < 10 || absZ < cfg.mediumThreshold) return 'high'
  if (sampleN < 50 || absZ < cfg.highThreshold)   return 'medium'
  return 'low'
}

function buildExplanation(opts: {
  hasBaseline:  boolean
  isAnomaly:    boolean
  metric:       string
  value:        number
  mean:         number
  stddev:       number
  zScore:       number
  confidence:   number
}): string {
  const { hasBaseline, isAnomaly, metric, value, mean, stddev, zScore, confidence } = opts

  if (!hasBaseline) {
    return `No historical baseline found for metric '${metric}'. Cannot evaluate anomaly.`
  }

  if (!isAnomaly) {
    return `Value ${value.toFixed(2)} is within normal range (mean ${mean.toFixed(2)} ± ${(2 * stddev).toFixed(2)}).`
  }

  const direction = zScore > 0 ? 'above' : 'below'
  return (
    `Detected anomaly: ${metric} value of ${value.toFixed(2)} is ` +
    `${Math.abs(zScore).toFixed(1)} standard deviations ${direction} the mean of ` +
    `${mean.toFixed(2)} (σ=${stddev.toFixed(2)}). Confidence: ${(confidence * 100).toFixed(0)}%.`
  )
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
      isAnomaly:         false,
      zScore:            0,
      severity:          'low',
      metric,
      value,
      mean:              0,
      stddev:            0,
      detectedAt,
      confidence:        0,
      falsePositiveRisk: 'high',
      explanation:       buildExplanation({
        hasBaseline: false,
        isAnomaly:   false,
        metric,
        value,
        mean:        0,
        stddev:      0,
        zScore:      0,
        confidence:  0,
      }),
    }
  }

  const { mean, stddev, sampleN } = baseline

  // Handle zero stddev edge cases
  if (stddev === 0) {
    if (value === mean) {
      const confidence = 0
      return {
        isAnomaly:         false,
        zScore:            0,
        severity:          'low',
        metric,
        value,
        mean,
        stddev,
        detectedAt,
        confidence,
        falsePositiveRisk: resolveFalsePositiveRisk(0, sampleN, cfg),
        explanation:       buildExplanation({
          hasBaseline: true,
          isAnomaly:   false,
          metric,
          value,
          mean,
          stddev,
          zScore:      0,
          confidence,
        }),
      }
    }
    // value !== mean with zero stddev → critical anomaly, clamp z to 10
    const zScore = 10
    const confidence = resolveConfidence(zScore, sampleN, cfg)
    return {
      isAnomaly:         true,
      zScore,
      severity:          'critical',
      metric,
      value,
      mean,
      stddev,
      detectedAt,
      confidence,
      falsePositiveRisk: resolveFalsePositiveRisk(zScore, sampleN, cfg),
      explanation:       buildExplanation({
        hasBaseline: true,
        isAnomaly:   true,
        metric,
        value,
        mean,
        stddev,
        zScore,
        confidence,
      }),
    }
  }

  const zScore = (value - mean) / stddev
  const absZ   = Math.abs(zScore)
  const isAnomaly = absZ >= cfg.lowThreshold
  const confidence = isAnomaly
    ? resolveConfidence(absZ, sampleN, cfg)
    : 0

  return {
    isAnomaly,
    zScore,
    severity:          resolveSeverity(absZ, cfg),
    metric,
    value,
    mean,
    stddev,
    detectedAt,
    confidence,
    falsePositiveRisk: resolveFalsePositiveRisk(absZ, sampleN, cfg),
    explanation:       buildExplanation({
      hasBaseline: true,
      isAnomaly,
      metric,
      value,
      mean,
      stddev,
      zScore,
      confidence,
    }),
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

// Group anomaly detection — detects if MULTIPLE metrics are anomalous simultaneously.
// Correlated anomalies across metrics are more suspicious than a single spike.
export async function detectAnomalyGroup(
  orgId: string,
  observations: Array<{ metric: string; value: number }>,
  config?: DetectorConfig
): Promise<GroupAnomalyResult> {
  const anomalies = await detectAnomalies(orgId, observations, config, false)

  const isGroupAnomaly = anomalies.length >= 2

  const groupConfidence =
    anomalies.length === 0
      ? 0
      : Math.min(
          1.0,
          Math.max(...anomalies.map((a) => a.confidence)) *
            (anomalies.length >= 3 ? 1.2 : 1.0)
        )

  const summary = `${anomalies.length} of ${observations.length} metrics are anomalous`

  return { anomalies, groupConfidence, isGroupAnomaly, summary }
}
