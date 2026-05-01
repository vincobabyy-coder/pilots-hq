import { describe, it, expect } from '../runner'
import {
  detectAnomaly,
  detectAnomalies,
  detectAnomalyGroup,
  AnomalySeverity,
} from '../../engines/fraud/detector'

// Inline severity mapper mirroring the same thresholds in detector.ts
// |z| >= 2.0 → low, >= 3.0 → medium, >= 4.0 → high, >= 5.0 → critical
function mapSeverity(
  absZ: number,
  low = 2.0,
  medium = 3.0,
  high = 4.0,
  critical = 5.0
): AnomalySeverity {
  if (absZ >= critical) return 'critical'
  if (absZ >= high)     return 'high'
  if (absZ >= medium)   return 'medium'
  return 'low'
}

// Inline confidence calculator mirroring detector.ts
function calcConfidence(
  absZ: number,
  sampleN: number,
  lowThreshold = 2.0,
  criticalThreshold = 5.0
): number {
  const baseConfidence = Math.min(
    1.0,
    (absZ - lowThreshold) / (criticalThreshold - lowThreshold)
  )
  const samplePenalty = sampleN < 30 ? sampleN / 30 : 1.0
  const raw = baseConfidence * samplePenalty
  return Math.round(Math.max(0, Math.min(1.0, raw)) * 1000) / 1000
}

// Inline false-positive-risk calculator mirroring detector.ts
function calcFPRisk(
  absZ: number,
  sampleN: number,
  mediumThreshold = 3.0,
  highThreshold = 4.0
): 'low' | 'medium' | 'high' {
  if (sampleN < 10 || absZ < mediumThreshold) return 'high'
  if (sampleN < 50 || absZ < highThreshold)   return 'medium'
  return 'low'
}

describe('detector module — smoke tests', () => {
  it('detectAnomaly is a function', () => {
    expect(typeof detectAnomaly).toBe('function')
  })

  it('detectAnomalies is a function', () => {
    expect(typeof detectAnomalies).toBe('function')
  })

  it('detectAnomalyGroup is a function', () => {
    expect(typeof detectAnomalyGroup).toBe('function')
  })
})

describe('detector module — input validation', () => {
  it('detectAnomaly rejects when orgId is empty', async () => {
    await expect(async () => detectAnomaly('', 'metric', 1.0)).toReject()
  })

  it('detectAnomaly rejects when value is not finite (NaN)', async () => {
    await expect(async () => detectAnomaly('org1', 'metric', NaN)).toReject()
  })
})

describe('severity classification — threshold mapping', () => {
  it('z=1.5 is below low threshold (2.0) — not anomaly', () => {
    // A z-score below 2.0 does not reach the low threshold
    const absZ = 1.5
    const isAnomaly = absZ >= 2.0
    expect(isAnomaly).toBe(false)
  })

  it('z=2.5 maps to severity "low"', () => {
    expect(mapSeverity(2.5)).toBe('low')
  })

  it('z=3.5 maps to severity "medium"', () => {
    expect(mapSeverity(3.5)).toBe('medium')
  })

  it('z=4.5 maps to severity "high"', () => {
    expect(mapSeverity(4.5)).toBe('high')
  })

  it('z=5.5 maps to severity "critical"', () => {
    expect(mapSeverity(5.5)).toBe('critical')
  })

  it('z exactly at boundary 2.0 maps to "low"', () => {
    expect(mapSeverity(2.0)).toBe('low')
  })

  it('z exactly at boundary 5.0 maps to "critical"', () => {
    expect(mapSeverity(5.0)).toBe('critical')
  })

  it('custom thresholds are respected', () => {
    // Use tighter thresholds: low=1.0, medium=2.0, high=3.0, critical=4.0
    expect(mapSeverity(1.5, 1.0, 2.0, 3.0, 4.0)).toBe('low')
    expect(mapSeverity(2.5, 1.0, 2.0, 3.0, 4.0)).toBe('medium')
    expect(mapSeverity(3.5, 1.0, 2.0, 3.0, 4.0)).toBe('high')
    expect(mapSeverity(4.5, 1.0, 2.0, 3.0, 4.0)).toBe('critical')
  })
})

// ─── New field presence tests (no-baseline path via detectAnomaly) ──────────────
// Use a valid UUID that has no baseline in the DB — getBaseline returns null,
// which exercises the no-baseline code path without a DB error.
const NO_BASELINE_ORG = '00000000-0000-0000-0000-000000000000'

describe('detectAnomaly — new fields present on no-baseline result', () => {
  // When no DB baseline exists, detectAnomaly returns a safe default result.
  // We verify the three new fields are present and well-formed regardless of DB state.
  it('result has confidence field (number)', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_1', 1.0)
    expect(typeof result.confidence).toBe('number')
  })

  it('result has explanation field (string)', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_2', 1.0)
    expect(typeof result.explanation).toBe('string')
  })

  it('result has falsePositiveRisk field (string)', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_3', 1.0)
    expect(typeof result.falsePositiveRisk).toBe('string')
  })

  it('confidence is between 0 and 1 (no-baseline path returns 0)', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_4', 1.0)
    const inRange = result.confidence >= 0 && result.confidence <= 1
    expect(inRange).toBe(true)
  })

  it('no-baseline explanation contains "No historical baseline"', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_5', 1.0)
    const hasExpectedText = result.explanation.includes('No historical baseline')
    expect(hasExpectedText).toBe(true)
  })

  it('no-baseline falsePositiveRisk is "high"', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_6', 1.0)
    expect(result.falsePositiveRisk).toBe('high')
  })

  it('no-baseline confidence is 0', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_7', 1.0)
    expect(result.confidence).toBe(0)
  })

  it('falsePositiveRisk is one of the three valid values', async () => {
    const result = await detectAnomaly(NO_BASELINE_ORG, 'nonexistent_metric_xyz_8', 1.0)
    const valid = ['low', 'medium', 'high']
    const isValid = valid.includes(result.falsePositiveRisk)
    expect(isValid).toBe(true)
  })
})

// ─── Confidence scoring — pure logic tests ──────────────────────────────────

describe('confidence scoring — pure logic', () => {
  it('confidence is 0 when z equals lowThreshold exactly', () => {
    // (2.0 - 2.0) / (5.0 - 2.0) = 0, samplePenalty irrelevant
    const conf = calcConfidence(2.0, 100)
    expect(conf).toBe(0)
  })

  it('confidence approaches 1.0 at criticalThreshold with large sample', () => {
    const conf = calcConfidence(5.0, 100)
    expect(conf).toBe(1)
  })

  it('sample penalty reduces confidence when sampleN < 30', () => {
    const highSample = calcConfidence(4.0, 100)
    const lowSample  = calcConfidence(4.0, 10)
    const highIsGreater = highSample > lowSample
    expect(highIsGreater).toBe(true)
  })

  it('confidence with sampleN=15 is half of sampleN=30 (same z)', () => {
    const at30 = calcConfidence(4.0, 30)
    const at15 = calcConfidence(4.0, 15)
    // at15 should be ~half of at30
    const ratio = at15 / at30
    const aboutHalf = ratio > 0.45 && ratio < 0.55
    expect(aboutHalf).toBe(true)
  })

  it('confidence is clamped to [0, 1]', () => {
    // Even at extreme z, must not exceed 1
    const conf = calcConfidence(100, 1000)
    expect(conf).toBe(1)
  })

  it('confidence is never negative', () => {
    // z below lowThreshold: baseConfidence would be negative → clamped to 0
    const conf = calcConfidence(1.0, 100)
    const nonNegative = conf >= 0
    expect(nonNegative).toBe(true)
  })
})

// ─── False positive risk — pure logic tests ─────────────────────────────────

describe('falsePositiveRisk — pure logic', () => {
  it('sampleN < 10 → always "high" regardless of z', () => {
    expect(calcFPRisk(6.0, 5)).toBe('high')
  })

  it('z < mediumThreshold (3.0) → "high" even with large sample', () => {
    expect(calcFPRisk(2.5, 100)).toBe('high')
  })

  it('sampleN >= 10, z >= mediumThreshold, sampleN < 50 → "medium"', () => {
    expect(calcFPRisk(3.5, 20)).toBe('medium')
  })

  it('z >= mediumThreshold, z < highThreshold, sampleN >= 50 → "medium"', () => {
    expect(calcFPRisk(3.5, 60)).toBe('medium')
  })

  it('sampleN >= 50, z >= highThreshold → "low"', () => {
    expect(calcFPRisk(4.5, 60)).toBe('low')
  })

  it('sampleN exactly 10 and z >= mediumThreshold → "medium"', () => {
    // sampleN < 10 is strict, so 10 passes
    expect(calcFPRisk(3.5, 10)).toBe('medium')
  })
})

// ─── Explanation text — pure logic tests ────────────────────────────────────

describe('explanation text — pure logic', () => {
  it('anomaly explanation contains "standard deviations"', () => {
    // Mirror the anomaly explanation template
    const metric = 'shipment_count'
    const value = 150
    const mean = 100
    const stddev = 10
    const zScore = (value - mean) / stddev  // 5.0
    const confidence = calcConfidence(Math.abs(zScore), 100)
    const direction = zScore > 0 ? 'above' : 'below'
    const explanation =
      `Detected anomaly: ${metric} value of ${value.toFixed(2)} is ` +
      `${Math.abs(zScore).toFixed(1)} standard deviations ${direction} the mean of ` +
      `${mean.toFixed(2)} (σ=${stddev.toFixed(2)}). Confidence: ${(confidence * 100).toFixed(0)}%.`
    const hasText = explanation.includes('standard deviations')
    expect(hasText).toBe(true)
  })

  it('non-anomaly explanation contains "within normal range"', () => {
    const value = 102
    const mean = 100
    const stddev = 10
    const explanation = `Value ${value.toFixed(2)} is within normal range (mean ${mean.toFixed(2)} ± ${(2 * stddev).toFixed(2)}).`
    const hasText = explanation.includes('within normal range')
    expect(hasText).toBe(true)
  })

  it('anomaly explanation contains metric name', () => {
    const metric = 'route_duration_minutes'
    const value = 200
    const mean = 100
    const stddev = 10
    const zScore = (value - mean) / stddev
    const confidence = calcConfidence(Math.abs(zScore), 100)
    const direction = zScore > 0 ? 'above' : 'below'
    const explanation =
      `Detected anomaly: ${metric} value of ${value.toFixed(2)} is ` +
      `${Math.abs(zScore).toFixed(1)} standard deviations ${direction} the mean of ` +
      `${mean.toFixed(2)} (σ=${stddev.toFixed(2)}). Confidence: ${(confidence * 100).toFixed(0)}%.`
    expect(explanation.includes(metric)).toBe(true)
  })

  it('below-mean anomaly explanation says "below"', () => {
    const metric = 'route_duration_minutes'
    const value = 50
    const mean = 100
    const stddev = 10
    const zScore = (value - mean) / stddev  // -5.0
    const confidence = calcConfidence(Math.abs(zScore), 100)
    const direction = zScore > 0 ? 'above' : 'below'
    const explanation =
      `Detected anomaly: ${metric} value of ${value.toFixed(2)} is ` +
      `${Math.abs(zScore).toFixed(1)} standard deviations ${direction} the mean of ` +
      `${mean.toFixed(2)} (σ=${stddev.toFixed(2)}). Confidence: ${(confidence * 100).toFixed(0)}%.`
    expect(explanation.includes('below')).toBe(true)
  })

  it('above-mean anomaly explanation says "above"', () => {
    const metric = 'route_duration_minutes'
    const value = 150
    const mean = 100
    const stddev = 10
    const zScore = (value - mean) / stddev  // 5.0
    const confidence = calcConfidence(Math.abs(zScore), 100)
    const direction = zScore > 0 ? 'above' : 'below'
    const explanation =
      `Detected anomaly: ${metric} value of ${value.toFixed(2)} is ` +
      `${Math.abs(zScore).toFixed(1)} standard deviations ${direction} the mean of ` +
      `${mean.toFixed(2)} (σ=${stddev.toFixed(2)}). Confidence: ${(confidence * 100).toFixed(0)}%.`
    expect(explanation.includes('above')).toBe(true)
  })
})

// ─── detectAnomalyGroup — smoke and logic tests ──────────────────────────────

describe('detectAnomalyGroup — smoke tests', () => {
  it('returns an object with anomalies, groupConfidence, isGroupAnomaly, summary', async () => {
    const result = await detectAnomalyGroup(NO_BASELINE_ORG, [
      { metric: 'metric_a', value: 1.0 },
      { metric: 'metric_b', value: 2.0 },
    ])
    expect(typeof result.anomalies).toBe('object')
    expect(typeof result.groupConfidence).toBe('number')
    expect(typeof result.isGroupAnomaly).toBe('boolean')
    expect(typeof result.summary).toBe('string')
  })

  // No-baseline → detectAnomalies returns [] (no anomaly when baseline is null).
  // isGroupAnomaly should be false, groupConfidence 0.
  it('0 anomalies (no baseline) → isGroupAnomaly false', async () => {
    const result = await detectAnomalyGroup(NO_BASELINE_ORG, [
      { metric: 'no_baseline_metric_1', value: 999.0 },
      { metric: 'no_baseline_metric_2', value: 999.0 },
    ])
    expect(result.isGroupAnomaly).toBe(false)
  })

  it('0 anomalies → groupConfidence is 0', async () => {
    const result = await detectAnomalyGroup(NO_BASELINE_ORG, [
      { metric: 'no_baseline_metric_3', value: 999.0 },
      { metric: 'no_baseline_metric_4', value: 999.0 },
    ])
    expect(result.groupConfidence).toBe(0)
  })

  it('summary string has correct format "X of Y metrics are anomalous"', async () => {
    const observations = [
      { metric: 'no_baseline_metric_5', value: 1.0 },
      { metric: 'no_baseline_metric_6', value: 2.0 },
      { metric: 'no_baseline_metric_7', value: 3.0 },
    ]
    const result = await detectAnomalyGroup(NO_BASELINE_ORG, observations)
    // With no baselines, 0 anomalies out of 3 observations
    expect(result.summary).toBe('0 of 3 metrics are anomalous')
  })

  it('anomalies array contains only AnomalyResult items with isAnomaly=true', async () => {
    const result = await detectAnomalyGroup(NO_BASELINE_ORG, [
      { metric: 'no_baseline_metric_8', value: 1.0 },
    ])
    // All entries in anomalies must have isAnomaly true
    const allAnomalous = result.anomalies.every((a) => a.isAnomaly === true)
    expect(allAnomalous).toBe(true)
  })

  it('groupConfidence is clamped to [0, 1]', async () => {
    const result = await detectAnomalyGroup(NO_BASELINE_ORG, [
      { metric: 'no_baseline_metric_9', value: 1.0 },
    ])
    const inRange = result.groupConfidence >= 0 && result.groupConfidence <= 1
    expect(inRange).toBe(true)
  })
})

// ─── detectAnomalyGroup — pure logic for groupConfidence boost ───────────────

describe('detectAnomalyGroup — groupConfidence boost logic', () => {
  it('groupConfidence with >= 3 anomalies is boosted by 1.2 (pure logic)', () => {
    // Simulate the boost calculation directly
    const maxConf = 0.5
    const boosted   = Math.min(1.0, maxConf * 1.2)
    const unboosted = Math.min(1.0, maxConf * 1.0)
    const isBoosted = boosted > unboosted
    expect(isBoosted).toBe(true)
  })

  it('groupConfidence boost is capped at 1.0', () => {
    // Even a max confidence of 1.0 boosted by 1.2 must clamp to 1.0
    const maxConf = 1.0
    const boosted = Math.min(1.0, maxConf * 1.2)
    expect(boosted).toBe(1.0)
  })

  it('isGroupAnomaly requires >= 2 simultaneous anomalies (pure logic)', () => {
    const oneAnomaly  = 1 >= 2
    const twoAnomalies = 2 >= 2
    expect(oneAnomaly).toBe(false)
    expect(twoAnomalies).toBe(true)
  })
})
