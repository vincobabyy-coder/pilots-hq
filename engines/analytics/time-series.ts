export interface DataPoint {
  timestamp: number // unix ms
  value: number
}

export interface DecomposedSeries {
  trend:    number[] // moving-average trend component
  seasonal: number[] // repeated seasonal component (same length as input)
  residual: number[] // remainder after trend+seasonal removed
  smoothed: number[] // trend + seasonal (denoised signal)
}

// Decomposes a time series using an additive model:
//   value = trend + seasonal + residual
//
// trend   – centred moving average (window = periodLength, or nearest odd number)
// seasonal – average deviation per period position across all complete periods
// residual – value - trend - seasonal
//
// Throws if data.length < 2 or periodLength < 2.
export function decompose(data: DataPoint[], periodLength: number): DecomposedSeries {
  if (data.length < 2) {
    throw new Error('decompose: data must have at least 2 points')
  }
  if (periodLength < 2) {
    throw new Error('decompose: periodLength must be at least 2')
  }

  const n = data.length
  const values = data.map((d) => d.value)

  // --- Step 1: centred moving average ---
  const trend: number[] = new Array(n).fill(NaN)

  if (periodLength % 2 === 1) {
    // Odd window: straightforward centred MA
    const half = Math.floor(periodLength / 2)
    for (let i = half; i < n - half; i++) {
      let sum = 0
      for (let j = i - half; j <= i + half; j++) {
        sum += values[j]
      }
      trend[i] = sum / periodLength
    }
  } else {
    // Even window: 2×m centred MA to avoid half-step shift.
    // First MA with window=periodLength, then average two adjacent values.
    const m = periodLength
    const firstMA: number[] = new Array(n).fill(NaN)
    const half = m / 2

    for (let i = half; i < n - half; i++) {
      let sum = 0
      for (let j = i - half; j < i + half; j++) {
        sum += values[j]
      }
      firstMA[i] = sum / m
    }

    // Average adjacent pairs of firstMA to get a truly centred result
    for (let i = half; i < n - half; i++) {
      if (!isNaN(firstMA[i]) && !isNaN(firstMA[i - 1])) {
        trend[i] = (firstMA[i] + firstMA[i - 1]) / 2
      }
    }
  }

  // --- Step 2: seasonal indices ---
  // For each period position k, seasonal[k] = mean of (value[i] - trend[i])
  // for all i where i % periodLength === k and trend[i] is not NaN.
  const seasonalByPosition: number[] = new Array(periodLength).fill(NaN)

  for (let k = 0; k < periodLength; k++) {
    const deviations: number[] = []
    for (let i = k; i < n; i += periodLength) {
      if (!isNaN(trend[i])) {
        deviations.push(values[i] - trend[i])
      }
    }
    if (deviations.length > 0) {
      seasonalByPosition[k] = deviations.reduce((a, b) => a + b, 0) / deviations.length
    }
  }

  // Build seasonal array (same length as input) by repeating the pattern
  const seasonal: number[] = new Array(n).fill(NaN)
  for (let i = 0; i < n; i++) {
    seasonal[i] = seasonalByPosition[i % periodLength]
  }

  // --- Step 3: residual and smoothed ---
  const residual: number[] = new Array(n).fill(NaN)
  const smoothed: number[] = new Array(n).fill(NaN)

  for (let i = 0; i < n; i++) {
    const s = isNaN(seasonal[i]) ? 0 : seasonal[i]
    if (!isNaN(trend[i])) {
      smoothed[i] = trend[i] + s
      residual[i] = values[i] - trend[i] - s
    }
  }

  return { trend, seasonal, residual, smoothed }
}

// Linear regression on the trend component.
// Returns { slope, intercept, rSquared }.
// NaN values in the trend array are skipped.
export function trendRegression(
  trend: number[]
): { slope: number; intercept: number; rSquared: number } {
  // Collect valid (index, value) pairs
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < trend.length; i++) {
    if (!isNaN(trend[i])) {
      xs.push(i)
      ys.push(trend[i])
    }
  }

  const n = xs.length
  if (n === 0) {
    return { slope: 0, intercept: 0, rSquared: 1 }
  }

  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let ssXX = 0
  let ssXY = 0
  let ssTot = 0
  let ssRes = 0

  for (let i = 0; i < n; i++) {
    ssXX += (xs[i] - meanX) ** 2
    ssXY += (xs[i] - meanX) * (ys[i] - meanY)
    ssTot += (ys[i] - meanY) ** 2
  }

  if (ssXX === 0) {
    // All x values identical — can't determine slope
    return { slope: 0, intercept: meanY, rSquared: ssTot === 0 ? 1 : 0 }
  }

  const slope = ssXY / ssXX
  const intercept = meanY - slope * meanX

  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept
    ssRes += (ys[i] - predicted) ** 2
  }

  const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return { slope, intercept, rSquared }
}
