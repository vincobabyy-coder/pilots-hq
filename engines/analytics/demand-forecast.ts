import { DataPoint, decompose, trendRegression } from './time-series'

export interface ForecastResult {
  forecastedValues: number[] // one per horizon step
  confidenceLow:    number[] // lower bound (1 sigma)
  confidenceHigh:   number[] // upper bound (1 sigma)
  mape:             number   // mean absolute percentage error on training data (0.0–1.0+)
}

// Projects demand `horizonSteps` periods into the future using:
//   1. Decompose historical data with periodLength
//   2. Fit linear regression on trend
//   3. Extrapolate trend by horizonSteps
//   4. Add seasonal component (repeating pattern)
//   5. Confidence band = ±stddev of residuals
//
// Throws if data.length < periodLength * 2 (need at least 2 complete periods).
// Clamps negative forecasts to 0.
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

  for (let h = 1; h <= horizonSteps; h++) {
    const futureIndex = n - 1 + h
    const trendValue = slope * futureIndex + intercept
    const seasonalValue = seasonalPattern[futureIndex % periodLength]
    const raw = trendValue + seasonalValue
    const clamped = Math.max(0, raw)

    forecastedValues.push(clamped)
    confidenceLow.push(Math.max(0, raw - residualStddev))
    confidenceHigh.push(Math.max(0, raw + residualStddev))
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

  return { forecastedValues, confidenceLow, confidenceHigh, mape }
}
