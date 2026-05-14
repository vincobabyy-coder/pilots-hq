import { describe, it, expect } from '../runner'
import {
  detectGpsOutliers,
  smoothGpsPoints,
  computeRobustSpeedStats,
  applySeasonalAdjustment,
  GpsPoint,
} from '../../engines/route-optimizer/data-quality'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePoints(coords: [number, number, number][]): GpsPoint[] {
  return coords.map(([lat, lon, timestampMs]) => ({ lat, lon, timestampMs }))
}

describe('detectGpsOutliers', () => {
  it('returns no outliers for a normal walking-speed sequence', () => {
    // Lagos coordinates, roughly 1 km apart, sampled every 5 minutes
    const points: GpsPoint[] = [
      { lat: 6.5244, lon: 3.3792, timestampMs: 0 },
      { lat: 6.5254, lon: 3.3802, timestampMs: 5 * 60 * 1000 },  // ~1.4 km in 5 min → 17 km/h
      { lat: 6.5264, lon: 3.3812, timestampMs: 10 * 60 * 1000 },
    ]
    const flags = detectGpsOutliers(points)
    expect(flags[0]).toBe(false)
    expect(flags[1]).toBe(false)
    expect(flags[2]).toBe(false)
  })

  it('flags a teleportation jump (1000 km in 1 second)', () => {
    const points: GpsPoint[] = [
      { lat: 6.5244, lon: 3.3792, timestampMs: 0 },
      { lat: 15.5244, lon: 3.3792, timestampMs: 1000 },  // ~1000 km in 1 second
    ]
    const flags = detectGpsOutliers(points)
    expect(flags[0]).toBe(false)
    expect(flags[1]).toBe(true)
  })

  it('first point is never flagged', () => {
    const points: GpsPoint[] = [
      { lat: 6.5244, lon: 3.3792, timestampMs: 0 },
    ]
    const flags = detectGpsOutliers(points)
    expect(flags[0]).toBe(false)
  })

  it('flags point with reversed timestamp', () => {
    const points: GpsPoint[] = [
      { lat: 6.5244, lon: 3.3792, timestampMs: 5000 },
      { lat: 6.5245, lon: 3.3793, timestampMs: 1000 }, // timestamp goes backwards
    ]
    const flags = detectGpsOutliers(points)
    expect(flags[1]).toBe(true)
  })

  it('respects custom maxSpeedKmh threshold', () => {
    // 30 km in 30 minutes = 60 km/h — fine at 200, outlier at 50
    const points: GpsPoint[] = [
      { lat: 6.5244, lon: 3.3792, timestampMs: 0 },
      { lat: 6.7944, lon: 3.3792, timestampMs: 30 * 60 * 1000 },
    ]
    const flagsPermissive = detectGpsOutliers(points, 200)
    const flagsStrict = detectGpsOutliers(points, 50)
    expect(flagsPermissive[1]).toBe(false)
    expect(flagsStrict[1]).toBe(true)
  })
})

describe('smoothGpsPoints', () => {
  it('returns empty array for empty input', () => {
    expect(smoothGpsPoints([])).toHaveLength(0)
  })

  it('returns single point unchanged', () => {
    const pts = makePoints([[6.5, 3.38, 0]])
    const result = smoothGpsPoints(pts)
    expect(result[0].lat).toBe(6.5)
    expect(result[0].lon).toBe(3.38)
  })

  it('smoothed middle point is closer to average of neighbors', () => {
    const points: GpsPoint[] = [
      { lat: 0.0, lon: 0.0, timestampMs: 0 },
      { lat: 10.0, lon: 10.0, timestampMs: 1000 },
      { lat: 0.0, lon: 0.0, timestampMs: 2000 },
    ]
    const result = smoothGpsPoints(points)
    // Middle point should be pulled toward 0 by neighbors
    expect(result[1].lat < 10.0).toBe(true)
    expect(result[1].lat > 0.0).toBe(true)
    // Exactly: 10*0.7 + 0*0.15 + 0*0.15 = 7.0
    expect(Math.abs(result[1].lat - 7.0) < 0.001).toBe(true)
  })

  it('preserves timestamps unchanged', () => {
    const points: GpsPoint[] = [
      { lat: 1, lon: 1, timestampMs: 1000 },
      { lat: 2, lon: 2, timestampMs: 2000 },
      { lat: 3, lon: 3, timestampMs: 3000 },
    ]
    const result = smoothGpsPoints(points)
    expect(result[0].timestampMs).toBe(1000)
    expect(result[1].timestampMs).toBe(2000)
    expect(result[2].timestampMs).toBe(3000)
  })

  it('output has same length as input', () => {
    const points = makePoints([[1, 1, 0], [2, 2, 1000], [3, 3, 2000], [4, 4, 3000]])
    expect(smoothGpsPoints(points)).toHaveLength(4)
  })
})

describe('computeRobustSpeedStats', () => {
  it('throws on empty samples', () => {
    expect(() => computeRobustSpeedStats([])).toThrow()
  })

  it('p50 is near median for uniform distribution', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    const stats = computeRobustSpeedStats(samples)
    // Median of 1..100 is 50.5; histogram approximation should be close
    expect(stats.p50 > 45).toBe(true)
    expect(stats.p50 < 55).toBe(true)
  })

  it('p25 < p50 < p75', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const stats = computeRobustSpeedStats(samples)
    expect(stats.p25 < stats.p50).toBe(true)
    expect(stats.p50 < stats.p75).toBe(true)
  })

  it('iqr equals p75 - p25', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const stats = computeRobustSpeedStats(samples)
    expect(Math.abs(stats.iqr - (stats.p75 - stats.p25)) < 0.001).toBe(true)
  })

  it('p95 is near top of range', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1)
    const stats = computeRobustSpeedStats(samples)
    expect(stats.p95 > 90).toBe(true)
  })
})

describe('applySeasonalAdjustment', () => {
  it('applies 0.7x factor at 8am Monday (peak hour, weekday)', () => {
    const base = 50
    const adjusted = applySeasonalAdjustment(base, 8, 1) // hour 8, Monday
    expect(Math.abs(adjusted - 35) < 0.01).toBe(true)
  })

  it('applies 0.7x factor at 17:00 Tuesday (evening peak)', () => {
    const adjusted = applySeasonalAdjustment(60, 17, 2)
    expect(Math.abs(adjusted - 42) < 0.01).toBe(true)
  })

  it('returns base speed unchanged at noon on a weekday (off-peak)', () => {
    const adjusted = applySeasonalAdjustment(50, 12, 3) // Wednesday noon
    expect(adjusted).toBe(50)
  })

  it('returns base speed unchanged on Sunday regardless of hour', () => {
    const adjusted = applySeasonalAdjustment(50, 8, 0) // Sunday 8am
    expect(adjusted).toBe(50)
  })

  it('returns base speed unchanged on Saturday', () => {
    const adjusted = applySeasonalAdjustment(50, 17, 6) // Saturday 17:00
    expect(adjusted).toBe(50)
  })

  it('applies 0.8x factor at hour 9 on a weekday (shoulder peak)', () => {
    const adjusted = applySeasonalAdjustment(100, 9, 4) // Friday 9am
    expect(Math.abs(adjusted - 80) < 0.01).toBe(true)
  })
})
