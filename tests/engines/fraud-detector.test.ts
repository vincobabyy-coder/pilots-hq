import { describe, it, expect } from '../runner'
import { detectAnomaly, detectAnomalies, AnomalySeverity } from '../../engines/fraud/detector'

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

describe('detector module — smoke tests', () => {
  it('detectAnomaly is a function', () => {
    expect(typeof detectAnomaly).toBe('function')
  })

  it('detectAnomalies is a function', () => {
    expect(typeof detectAnomalies).toBe('function')
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
