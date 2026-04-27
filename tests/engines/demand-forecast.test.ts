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
