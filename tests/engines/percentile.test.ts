import { describe, it, expect } from '../runner'
import {
  buildHistogram,
  percentileFromHistogram,
  computePercentiles,
  mergeHistograms,
  Histogram,
} from '../../engines/analytics/percentile'

// Generates [1, 2, 3, ..., n]
function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1)
}

describe('buildHistogram', () => {
  it('count === 100 for [1..100]', () => {
    const h = buildHistogram(range(100))
    expect(h.count).toBe(100)
  })

  it('throws on empty data', () => {
    expect(() => buildHistogram([])).toThrow()
  })

  it('handles all-same values without throwing', () => {
    const h = buildHistogram([7, 7, 7, 7, 7])
    const total = h.buckets.reduce((a, b) => a + b, 0)
    expect(total).toBe(5)
  })
})

describe('percentileFromHistogram', () => {
  it('p=50 is approximately 50 (±5 tolerance) for [1..100]', () => {
    const h = buildHistogram(range(100))
    const p50 = percentileFromHistogram(h, 50)
    expect(p50 >= 45 && p50 <= 55).toBe(true)
  })

  it('p=0 is close to min', () => {
    const h = buildHistogram(range(100))
    const p0 = percentileFromHistogram(h, 0)
    // Should be close to 1 (the minimum)
    expect(p0 >= 0 && p0 <= 5).toBe(true)
  })

  it('p=100 is close to max', () => {
    const h = buildHistogram(range(100))
    const p100 = percentileFromHistogram(h, 100)
    // Should be close to 100 (the maximum)
    expect(p100 >= 95 && p100 <= 101).toBe(true)
  })

  it('throws when p < 0', () => {
    const h = buildHistogram(range(10))
    expect(() => percentileFromHistogram(h, -1)).toThrow()
  })

  it('throws when p > 100', () => {
    const h = buildHistogram(range(10))
    expect(() => percentileFromHistogram(h, 101)).toThrow()
  })
})

describe('computePercentiles', () => {
  it('p50 < p95 < p99 for [1..100]', () => {
    const { p50, p95, p99 } = computePercentiles(range(100))
    expect(p50 < p95).toBe(true)
    expect(p95 < p99).toBe(true)
  })
})

describe('mergeHistograms', () => {
  it('two histograms over same range merge to combined count', () => {
    const hA = buildHistogram(range(50))
    const hB = buildHistogram(range(50))
    const merged = mergeHistograms(hA, hB)
    expect(merged.count).toBe(100)
    const bucketTotal = merged.buckets.reduce((a, b) => a + b, 0)
    expect(bucketTotal).toBe(100)
  })

  it('throws on incompatible histograms (different min)', () => {
    const hA = buildHistogram([1, 2, 3, 4, 5])
    // Manually craft an incompatible histogram with a different min
    const hB: Histogram = {
      buckets: hA.buckets.slice(),
      min: 10,
      max: hA.max,
      count: hA.count,
      bucketWidth: hA.bucketWidth,
    }
    expect(() => mergeHistograms(hA, hB)).toThrow()
  })
})
