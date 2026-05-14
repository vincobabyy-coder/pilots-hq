import { haversineKm } from './distance-matrix'
import { buildHistogram, percentileFromHistogram } from '../analytics/percentile'

export interface GpsPoint {
  lat: number
  lon: number
  timestampMs: number
}

export interface RobustSpeedStats {
  p25: number
  p50: number
  p75: number
  p95: number
  iqr: number
}

// Peak-hour multipliers: weekdays 7–9 and 17–19 are congested.
// Values represent speed as a fraction of the free-flow baseline.
const PEAK_HOUR_FACTOR: Record<number, number> = {
  7: 0.7, 8: 0.7, 9: 0.8,
  17: 0.7, 18: 0.7, 19: 0.8,
}

/**
 * Flags GPS points that are physically impossible given the elapsed time.
 * Returns a boolean array parallel to `points` where true = outlier.
 * The first point is never flagged (no prior reference).
 */
export function detectGpsOutliers(points: GpsPoint[], maxSpeedKmh = 200): boolean[] {
  const flags: boolean[] = new Array(points.length).fill(false)
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const dtHours = (curr.timestampMs - prev.timestampMs) / (1000 * 3600)
    if (dtHours <= 0) {
      // Same or reversed timestamp — treat as outlier
      flags[i] = true
      continue
    }
    const distKm = haversineKm(prev.lat, prev.lon, curr.lat, curr.lon)
    const impliedSpeedKmh = distKm / dtHours
    if (impliedSpeedKmh > maxSpeedKmh) {
      flags[i] = true
    }
  }
  return flags
}

/**
 * Smooths GPS track using a weighted average with neighbors:
 *   0.7 × current + 0.15 × previous + 0.15 × next
 * Boundary points use only available neighbors (no wrap-around).
 * Timestamps are preserved unchanged.
 */
export function smoothGpsPoints(points: GpsPoint[]): GpsPoint[] {
  if (points.length === 0) return []
  if (points.length === 1) return [{ ...points[0] }]

  return points.map((curr, i) => {
    const prev = points[i - 1]
    const next = points[i + 1]

    if (!prev && !next) {
      return { ...curr }
    }

    if (!prev) {
      // First point: blend with next only
      return {
        lat: curr.lat * 0.85 + next.lat * 0.15,
        lon: curr.lon * 0.85 + next.lon * 0.15,
        timestampMs: curr.timestampMs,
      }
    }

    if (!next) {
      // Last point: blend with prev only
      return {
        lat: curr.lat * 0.85 + prev.lat * 0.15,
        lon: curr.lon * 0.85 + prev.lon * 0.15,
        timestampMs: curr.timestampMs,
      }
    }

    return {
      lat: curr.lat * 0.7 + prev.lat * 0.15 + next.lat * 0.15,
      lon: curr.lon * 0.7 + prev.lon * 0.15 + next.lon * 0.15,
      timestampMs: curr.timestampMs,
    }
  })
}

/**
 * Computes robust speed statistics using histogram percentiles.
 * Unlike mean+stddev, IQR-based stats are resistant to GPS noise spikes.
 */
export function computeRobustSpeedStats(samples: number[]): RobustSpeedStats {
  if (samples.length === 0) throw new Error('computeRobustSpeedStats: samples must not be empty')
  const h = buildHistogram(samples)
  const p25 = percentileFromHistogram(h, 25)
  const p50 = percentileFromHistogram(h, 50)
  const p75 = percentileFromHistogram(h, 75)
  const p95 = percentileFromHistogram(h, 95)
  return { p25, p50, p75, p95, iqr: p75 - p25 }
}

/**
 * Adjusts a free-flow speed estimate for time-of-day congestion.
 * Weekdays (Mon=1…Fri=5) during peak hours get a 0.7–0.8× factor.
 * All other slots return baseSpeedKmh unchanged.
 */
export function applySeasonalAdjustment(
  baseSpeedKmh: number,
  hourOfDay: number,
  dayOfWeek: number  // 0 = Sunday … 6 = Saturday
): number {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  if (!isWeekday) return baseSpeedKmh
  const factor = PEAK_HOUR_FACTOR[hourOfDay]
  if (factor === undefined) return baseSpeedKmh
  return baseSpeedKmh * factor
}
