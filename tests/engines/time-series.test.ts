import { describe, it, expect } from '../runner'
import { decompose, trendRegression, DataPoint } from '../../engines/analytics/time-series'

function makePoints(values: number[]): DataPoint[] {
  return values.map((value, i) => ({ timestamp: i * 1000, value }))
}

describe('time-series decompose — odd period', () => {
  it('trend has NaN at edges and non-NaN in middle', () => {
    const data = makePoints([1, 2, 3, 1, 2, 3, 1, 2, 3])
    const { trend } = decompose(data, 3)
    // For period=3, half=1 → edges 0 and 8 should be NaN
    expect(isNaN(trend[0])).toBe(true)
    expect(isNaN(trend[trend.length - 1])).toBe(true)
    // Middle values should not be NaN
    const middleNonNaN = trend.slice(1, trend.length - 1).some(v => !isNaN(v))
    expect(middleNonNaN).toBe(true)
  })

  it('smoothed values are close to the original repeating pattern', () => {
    const data = makePoints([1, 2, 3, 1, 2, 3, 1, 2, 3])
    const { smoothed } = decompose(data, 3)
    // Check non-NaN smoothed values are within ±1.5 of original
    smoothed.forEach((s, i) => {
      if (!isNaN(s)) {
        const diff = Math.abs(s - data[i].value)
        expect(diff < 1.5).toBe(true)
      }
    })
  })
})

describe('time-series decompose — even period', () => {
  it('does not throw for even period with 8 alternating points', () => {
    const data = makePoints([10, 20, 10, 20, 10, 20, 10, 20])
    const result = decompose(data, 2)
    expect(result.trend.length).toBe(8)
  })

  it('trend has some non-NaN values for even period', () => {
    const data = makePoints([10, 20, 10, 20, 10, 20, 10, 20])
    const { trend } = decompose(data, 2)
    const nonNaN = trend.filter(v => !isNaN(v))
    expect(nonNaN.length > 0).toBe(true)
  })
})

describe('time-series decompose — error cases', () => {
  it('throws when data.length < 2', () => {
    expect(() => decompose([{ timestamp: 0, value: 1 }], 3)).toThrow()
  })

  it('throws when periodLength < 2', () => {
    const data = makePoints([1, 2, 3, 4, 5])
    expect(() => decompose(data, 1)).toThrow()
  })
})

describe('time-series trendRegression', () => {
  it('perfect linear data [1,2,3,4,5]: slope > 0 and rSquared ≈ 1.0', () => {
    const { slope, rSquared } = trendRegression([1, 2, 3, 4, 5])
    expect(slope > 0).toBe(true)
    expect(Math.abs(rSquared - 1.0) < 0.0001).toBe(true)
  })

  it('flat data [5,5,5,5]: slope ≈ 0', () => {
    const { slope } = trendRegression([5, 5, 5, 5])
    expect(Math.abs(slope) < 0.0001).toBe(true)
  })
})
