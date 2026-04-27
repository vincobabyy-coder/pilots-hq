export interface Histogram {
  buckets:     number[] // count per bucket
  min:         number
  max:         number
  count:       number
  bucketWidth: number
}

// Builds a histogram with `numBuckets` equal-width buckets.
// Throws if data is empty or numBuckets < 1.
export function buildHistogram(data: number[], numBuckets = 100): Histogram {
  if (data.length === 0) {
    throw new Error('buildHistogram: data must not be empty')
  }
  if (numBuckets < 1) {
    throw new Error('buildHistogram: numBuckets must be at least 1')
  }

  let min = data[0]
  let max = data[0]
  for (const v of data) {
    if (v < min) min = v
    if (v > max) max = v
  }

  // When all values are identical, give the histogram a width of 1 so bucket
  // arithmetic doesn't produce divisions by zero.
  const range = max - min || 1
  const bucketWidth = range / numBuckets
  const buckets: number[] = new Array(numBuckets).fill(0)

  for (const v of data) {
    let idx = Math.floor((v - min) / bucketWidth)
    // Clamp: the maximum value falls exactly on the upper boundary
    if (idx >= numBuckets) idx = numBuckets - 1
    buckets[idx]++
  }

  return { buckets, min, max, count: data.length, bucketWidth }
}

// Returns approximate percentile value (0–100) from histogram.
// Uses linear interpolation within the bucket.
// Throws if p < 0 or p > 100 or histogram.count === 0.
export function percentileFromHistogram(histogram: Histogram, p: number): number {
  if (p < 0 || p > 100) {
    throw new Error(`percentileFromHistogram: p must be between 0 and 100, got ${p}`)
  }
  if (histogram.count === 0) {
    throw new Error('percentileFromHistogram: histogram is empty')
  }

  // Target rank in [0, count]
  const target = (p / 100) * histogram.count

  let cumulative = 0
  for (let i = 0; i < histogram.buckets.length; i++) {
    const prevCumulative = cumulative
    cumulative += histogram.buckets[i]

    if (cumulative >= target || i === histogram.buckets.length - 1) {
      // Linear interpolation within the bucket
      const bucketLow  = histogram.min + i * histogram.bucketWidth
      const bucketHigh = bucketLow + histogram.bucketWidth

      const countInBucket = histogram.buckets[i]
      if (countInBucket === 0) {
        return bucketLow
      }

      // How far through this bucket is the target rank?
      const fraction = (target - prevCumulative) / countInBucket
      return bucketLow + fraction * (bucketHigh - bucketLow)
    }
  }

  // Should never reach here, but satisfy TypeScript's noImplicitReturns
  return histogram.max
}

// Convenience: compute P50, P95, P99 in one call.
export function computePercentiles(data: number[]): { p50: number; p95: number; p99: number } {
  const histogram = buildHistogram(data)
  return {
    p50: percentileFromHistogram(histogram, 50),
    p95: percentileFromHistogram(histogram, 95),
    p99: percentileFromHistogram(histogram, 99),
  }
}

// Merges two histograms with compatible bucket structure (same min/max/numBuckets).
// Throws if structures differ.
export function mergeHistograms(a: Histogram, b: Histogram): Histogram {
  if (
    a.min !== b.min ||
    a.max !== b.max ||
    a.buckets.length !== b.buckets.length ||
    a.bucketWidth !== b.bucketWidth
  ) {
    throw new Error(
      'mergeHistograms: histograms must have identical min, max, numBuckets, and bucketWidth'
    )
  }

  const buckets = a.buckets.map((count, i) => count + b.buckets[i])

  return {
    buckets,
    min:         a.min,
    max:         a.max,
    count:       a.count + b.count,
    bucketWidth: a.bucketWidth,
  }
}
