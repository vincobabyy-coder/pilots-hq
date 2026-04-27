import { describe, it, expect } from '../runner'
import {
  initCusumState,
  updateCusum,
  resetCusum,
  processBatch,
  CusumState,
} from '../../engines/fraud/cusum'

describe('CUSUM initCusumState', () => {
  it('k ≈ 1.0, h ≈ 10.0, mean=10 for initCusumState(10, 2)', () => {
    const state = initCusumState(10, 2)
    // k = 0.5 * sigma = 0.5 * 2 = 1.0
    expect(Math.abs(state.k - 1.0) < 0.0001).toBe(true)
    // h = 5 * sigma = 5 * 2 = 10.0
    expect(Math.abs(state.h - 10.0) < 0.0001).toBe(true)
    expect(state.mean).toBe(10)
    expect(state.cusum_pos).toBe(0)
    expect(state.cusum_neg).toBe(0)
  })

  it('sigma=0 uses minimum values — no NaN or Infinity', () => {
    const state = initCusumState(5, 0)
    expect(Number.isFinite(state.k)).toBe(true)
    expect(Number.isFinite(state.h)).toBe(true)
    expect(Number.isNaN(state.k)).toBe(false)
    expect(Number.isNaN(state.h)).toBe(false)
    // k and h should use the floored minimums
    expect(state.k > 0).toBe(true)
    expect(state.h > 0).toBe(true)
  })
})

describe('CUSUM updateCusum — no alert at mean', () => {
  it('5 observations exactly at mean produce no alert', () => {
    let state: CusumState = initCusumState(10, 2)
    let lastResult = updateCusum(state, 10)
    for (let i = 0; i < 4; i++) {
      lastResult = updateCusum(lastResult.newState, 10)
    }
    expect(lastResult.alertUp).toBe(false)
    expect(lastResult.alertDown).toBe(false)
    expect(lastResult.isAlert).toBe(false)
  })
})

describe('CUSUM updateCusum — upward alert', () => {
  it('10 observations of mean + 4*sigma eventually trigger alertUp=true', () => {
    const mean = 10
    const sigma = 2
    let state: CusumState = initCusumState(mean, sigma)
    let triggered = false
    for (let i = 0; i < 10; i++) {
      const result = updateCusum(state, mean + 4 * sigma)
      state = result.newState
      if (result.alertUp) triggered = true
    }
    expect(triggered).toBe(true)
  })
})

describe('CUSUM updateCusum — downward alert', () => {
  it('10 observations of mean - 4*sigma trigger alertDown=true', () => {
    const mean = 10
    const sigma = 2
    let state: CusumState = initCusumState(mean, sigma)
    let triggered = false
    for (let i = 0; i < 10; i++) {
      const result = updateCusum(state, mean - 4 * sigma)
      state = result.newState
      if (result.alertDown) triggered = true
    }
    expect(triggered).toBe(true)
  })
})

describe('CUSUM resetCusum', () => {
  it('after alert: cusumPos=0, cusumNeg=0, k/h/mean unchanged', () => {
    let state: CusumState = initCusumState(10, 2)
    // Drive cusum_pos up by repeated high observations
    for (let i = 0; i < 6; i++) {
      state = updateCusum(state, 30).newState
    }
    const savedK = state.k
    const savedH = state.h
    const savedMean = state.mean
    const reset = resetCusum(state)
    expect(reset.cusum_pos).toBe(0)
    expect(reset.cusum_neg).toBe(0)
    expect(reset.k).toBe(savedK)
    expect(reset.h).toBe(savedH)
    expect(reset.mean).toBe(savedMean)
  })
})

describe('CUSUM processBatch', () => {
  it('returns array of length 20 for 20 observations', () => {
    const state = initCusumState(10, 2)
    const observations = Array.from({ length: 20 }, () => 10)
    const results = processBatch(state, observations)
    expect(results).toHaveLength(20)
  })
})
