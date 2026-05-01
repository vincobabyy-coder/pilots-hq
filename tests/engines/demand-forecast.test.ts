import { describe, it, expect } from '../runner'
import { forecastDemand } from '../../engines/analytics/demand-forecast'
import { DataPoint } from '../../engines/analytics/time-series'

function makeLinearSeasonal(n: number, period: number): DataPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: i * 1000,
    // linear trend + seasonal component that repeats every `period` steps
    value: 10 + i * 0.5 + (i % period === 0 ? 2 : i % period === 1 ? -2 : 0),
  }))
}

describe('forecastDemand — basic forecast', () => {
  it('returns correct number of forecasted values', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    expect(result.forecastedValues).toHaveLength(4)
    expect(result.confidenceLow).toHaveLength(4)
    expect(result.confidenceHigh).toHaveLength(4)
  })

  it('all forecasted values are non-negative', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    result.forecastedValues.forEach(v => {
      expect(v >= 0).toBe(true)
    })
  })

  it('confidenceLow <= forecastedValues <= confidenceHigh', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    for (let i = 0; i < 4; i++) {
      expect(result.confidenceLow[i] <= result.forecastedValues[i]).toBe(true)
      expect(result.forecastedValues[i] <= result.confidenceHigh[i]).toBe(true)
    }
  })
})

describe('forecastDemand — error cases', () => {
  it('throws when data.length < periodLength * 2', () => {
    // period=4 requires at least 8 points; provide only 5
    const data: DataPoint[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: i * 1000,
      value: i + 1,
    }))
    expect(() => forecastDemand(data, 4, 4)).toThrow()
  })
})

describe('forecastDemand — MAPE', () => {
  it('mape is between 0 and 1 for near-perfect linear data with tiny noise', () => {
    // Linearly increasing values with a tiny noise term
    const data: DataPoint[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: i * 1000,
      value: 100 + i * 2 + (i % 2 === 0 ? 0.01 : -0.01),
    }))
    const result = forecastDemand(data, 4, 2)
    // mape should be small but within valid range
    expect(result.mape >= 0).toBe(true)
    expect(result.mape <= 1).toBe(true)
  })
})

describe('forecastDemand — negative clamp', () => {
  it('forecasted values are clamped to >= 0 when trend points negative', () => {
    // Strong downtrend that would forecast negative values
    const data: DataPoint[] = Array.from({ length: 16 }, (_, i) => ({
      timestamp: i * 1000,
      value: Math.max(0, 100 - i * 15),
    }))
    const result = forecastDemand(data, 4, 4)
    result.forecastedValues.forEach(v => {
      expect(v >= 0).toBe(true)
    })
    result.confidenceLow.forEach(v => {
      expect(v >= 0).toBe(true)
    })
  })
})

describe('forecastDemand — new fields (Phase 2.2)', () => {
  it('result has all new fields: coldStart, decomposition, confidenceBands', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)

    // Verify fields exist by checking their types / truthiness
    expect(typeof result.coldStart).toBe('boolean')
    expect(typeof result.decomposition).toBe('object')
    expect(typeof result.confidenceBands).toBe('object')
    expect(Array.isArray(result.confidenceBands.p25)).toBe(true)
    expect(Array.isArray(result.confidenceBands.p75)).toBe(true)
    expect(Array.isArray(result.confidenceBands.p10)).toBe(true)
    expect(Array.isArray(result.confidenceBands.p90)).toBe(true)
  })

  it('coldStart is true when data.length < periodLength * 3', () => {
    // period=4, need <12 points but >= 8; use exactly 8
    const data = makeLinearSeasonal(8, 4)
    const result = forecastDemand(data, 4, 2)
    expect(result.coldStart).toBe(true)
  })

  it('coldStart is false when data.length >= periodLength * 3', () => {
    // period=4, need >= 12 points; use 16
    const data = makeLinearSeasonal(16, 4)
    const result = forecastDemand(data, 4, 2)
    expect(result.coldStart).toBe(false)
  })

  it('p90 >= p75 >= forecastedValue >= p25 >= p10 for all horizon steps', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    const { p10, p25, p75, p90 } = result.confidenceBands

    for (let i = 0; i < 4; i++) {
      expect(p90[i] >= p75[i]).toBe(true)
      expect(p75[i] >= result.forecastedValues[i]).toBe(true)
      expect(result.forecastedValues[i] >= p25[i]).toBe(true)
      expect(p25[i] >= p10[i]).toBe(true)
    }
  })

  it('byPeriod.length === periodLength', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    expect(result.decomposition.byPeriod).toHaveLength(4)
  })

  it('decomposition.trendSlopePerStep is a finite number', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    const slope = result.decomposition.trendSlopePerStep
    expect(typeof slope).toBe('number')
    expect(isFinite(slope)).toBe(true)
  })

  it('decomposition.seasonalityStrength is in [0, 1]', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    const strength = result.decomposition.seasonalityStrength
    expect(strength >= 0).toBe(true)
    expect(strength <= 1).toBe(true)
  })

  it('p10 equals confidenceLow and p90 equals confidenceHigh', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    for (let i = 0; i < 4; i++) {
      expect(result.confidenceBands.p10[i]).toBe(result.confidenceLow[i])
      expect(result.confidenceBands.p90[i]).toBe(result.confidenceHigh[i])
    }
  })

  it('byPeriod entries have correct shape', () => {
    const data = makeLinearSeasonal(24, 4)
    const result = forecastDemand(data, 4, 4)
    result.decomposition.byPeriod.forEach((entry, idx) => {
      expect(entry.periodIndex).toBe(idx)
      expect(typeof entry.adjustment).toBe('number')
    })
  })
})
