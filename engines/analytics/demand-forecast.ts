import { DataPoint, decompose, trendRegression } from './time-series'

export interface SeasonalityByPeriod {
  periodIndex: number   // 0-based position in the cycle
  adjustment:  number   // average seasonal adjustment for this position
}

export interface DecompositionSummary {
  trendSlopePerStep:    number                // regression slope (demand change per time step)
  trendPercent:         number                // variance of trend values / variance of raw data (0–1)
  seasonalityStrength:  number                // seasonal range / (seasonal range + residual range) clamped [0,1]
  byPeriod:             SeasonalityByPeriod[] // seasonal adjustments per position
}

export interface ForecastResult {
  forecastedValues: number[]               // one per horizon step
  confidenceLow:    number[]               // p10 band (−1.28 × σ)
  confidenceHigh:   number[]               // p90 band (+1.28 × σ)
  confidenceBands: {
    p25: number[]; p75: number[]           // interquartile (±0.674 × σ)
    p10: number[]; p90: number[]           // same as confidenceLow/High
  }
  mape:          number                    // MAPE on training data
  coldStart:     boolean                   // true if data.length < periodLength * 3
  decomposition: DecompositionSummary
}

// Projects demand `horizonSteps` periods into the future using:
//   1. Decompose historical data with periodLength
//   2. Fit linear regression on trend
//   3. Extrapolate trend by horizonSteps
//   4. Add seasonal component (repeating pattern)
//   5. Confidence bands derived from residual stddev
//
// Throws if data.length < periodLength * 2 (need at least 2 complete periods).
// Clamps negative forecasts to 0.
// Sets coldStart: true when data.length < periodLength * 3 (limited history warning).
export function forecastDemand(
  data: DataPoint[],
  periodLength: number,
  horizonSteps: number
): ForecastResult {
  if (data.length < periodLength * 2) {
    throw new Error(
      `forecastDemand: need at least ${periodLength * 2} data points (2 complete periods), got ${data.length}`
    )
  }
  if (horizonSteps < 1) {
    throw new Error('forecastDemand: horizonSteps must be at least 1')
  }

  const coldStart = data.length < periodLength * 3

  const n = data.length
  const decomposed = decompose(data, periodLength)
  const { trend, seasonal, residual } = decomposed
  const regression = trendRegression(trend)
  const { slope, intercept } = regression

  // --- Residual stddev (for confidence bands) ---
  const validResiduals = residual.filter((r) => !isNaN(r))
  let residualStddev = 0

  if (validResiduals.length > 1) {
    const meanRes = validResiduals.reduce((a, b) => a + b, 0) / validResiduals.length
    const variance =
      validResiduals.reduce((acc, r) => acc + (r - meanRes) ** 2, 0) /
      (validResiduals.length - 1)
    residualStddev = Math.sqrt(variance)
  }

  // --- Seasonal pattern: use the repeating indices ---
  // Build the base seasonal pattern (length = periodLength) from position offsets
  const seasonalPattern: number[] = new Array(periodLength).fill(0)
  const positionCounts: number[] = new Array(periodLength).fill(0)

  for (let i = 0; i < n; i++) {
    const s = seasonal[i]
    if (!isNaN(s)) {
      seasonalPattern[i % periodLength] += s
      positionCounts[i % periodLength] += 1
    }
  }
  for (let k = 0; k < periodLength; k++) {
    if (positionCounts[k] > 0) {
      seasonalPattern[k] /= positionCounts[k]
    }
  }

  // --- Extrapolate ---
  const forecastedValues: number[] = []
  const confidenceLow: number[]    = []
  const confidenceHigh: number[]   = []
  const p25: number[]              = []
  const p75: number[]              = []

  for (let h = 1; h <= horizonSteps; h++) {
    const futureIndex = n - 1 + h
    const trendValue = slope * futureIndex + intercept
    const seasonalValue = seasonalPattern[futureIndex % periodLength]
    const raw = trendValue + seasonalValue
    const clamped = Math.max(0, raw)

    forecastedValues.push(clamped)
    confidenceLow.push(Math.max(0, raw - 1.28 * residualStddev))
    confidenceHigh.push(Math.max(0, raw + 1.28 * residualStddev))
    p25.push(Math.max(0, raw - 0.674 * residualStddev))
    p75.push(Math.max(0, raw + 0.674 * residualStddev))
  }

  const confidenceBands = {
    p25,
    p75,
    p10: confidenceLow,
    p90: confidenceHigh,
  }

  // --- MAPE on training data ---
  // fitted[i] = trend[i] + seasonal[i]; only where both are not NaN and actual > 0
  let mapeSum = 0
  let mapeCount = 0

  for (let i = 0; i < n; i++) {
    const actual = data[i].value
    if (actual > 0 && !isNaN(trend[i]) && !isNaN(seasonal[i])) {
      const fitted = trend[i] + seasonal[i]
      mapeSum += Math.abs(actual - fitted) / actual
      mapeCount++
    }
  }

  const mape = mapeCount > 0 ? mapeSum / mapeCount : 0

  // --- Decomposition summary ---

  // trendPercent: variance of trend values / variance of raw data (population variance)
  const validTrend = trend.filter((t) => !isNaN(t))
  const rawValues = data.map((d) => d.value)

  function populationVariance(arr: number[]): number {
    if (arr.length === 0) return 0
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    return arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length
  }

  const trendVariance = populationVariance(validTrend)
  const rawVariance = populationVariance(rawValues)
  const trendPercent = rawVariance === 0 ? 1 : Math.min(1, Math.max(0, trendVariance / rawVariance))

  // seasonalityStrength: seasonal range / (seasonal range + residual range)
  // range = max - min of non-NaN values
  const validSeasonal = seasonal.filter((s) => !isNaN(s))
  const seasonalRange =
    validSeasonal.length > 0
      ? Math.max(...validSeasonal) - Math.min(...validSeasonal)
      : 0

  const residualRange =
    validResiduals.length > 0
      ? Math.max(...validResiduals) - Math.min(...validResiduals)
      : 0

  let seasonalityStrength: number
  if (residualRange === 0) {
    seasonalityStrength = 1.0
  } else {
    seasonalityStrength = Math.min(1, Math.max(0, seasonalRange / (seasonalRange + residualRange)))
  }

  // byPeriod: array derived from the seasonal pattern built during extrapolation
  const byPeriod: SeasonalityByPeriod[] = seasonalPattern.map((adjustment, periodIndex) => ({
    periodIndex,
    adjustment,
  }))

  const decomposition: DecompositionSummary = {
    trendSlopePerStep: slope,
    trendPercent,
    seasonalityStrength,
    byPeriod,
  }

  return {
    forecastedValues,
    confidenceLow,
    confidenceHigh,
    confidenceBands,
    mape,
    coldStart,
    decomposition,
  }
}
