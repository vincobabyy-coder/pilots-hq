import { query } from '../../core/db/pool'

export interface RouteStop {
  lat: number
  lon: number
}

export interface ETAConfidenceInterval {
  p10EtaMinutes: number  // optimistic ETA — 90th-percentile speed (fast traffic)
  p50EtaMinutes: number  // median ETA
  p90EtaMinutes: number  // pessimistic ETA — 10th-percentile speed (slow traffic), use for SLA commitments
  p99EtaMinutes: number  // worst-case ETA — very slow traffic
}

export interface DeliveryPrediction {
  estimatedMinutes: number
  eta: ETAConfidenceInterval
  breakdown: Array<{
    fromStop:         number
    toStop:           number
    distanceKm:       number
    estimatedMinutes: number
  }>
}

// Haversine formula — returns distance in kilometres between two lat/lon points.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface SpeedProfileRow extends Record<string, unknown> {
  avg_speed_kmh: number
}

// Predicts total delivery time for a route starting at `departureDate`.
//
// For each leg, fetches the speed profile from DB for (orgId, hourOfDay, dayOfWeek).
// Falls back to defaultSpeedKmh (default: 50) if no profile row is found.
// Throws if stops.length < 2.
export async function predictDelivery(
  orgId: string,
  stops: RouteStop[],
  departureDate: Date,
  defaultSpeedKmh = 50
): Promise<DeliveryPrediction> {
  if (stops.length < 2) {
    throw new Error('predictDelivery: at least 2 stops are required')
  }

  const breakdown: DeliveryPrediction['breakdown'] = []
  let totalMinutes = 0

  // We track elapsed time to estimate the hour/day for each leg
  let elapsedMs = 0

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]
    const to   = stops[i + 1]

    const distanceKm = haversineKm(from.lat, from.lon, to.lat, to.lon)

    // Departure time for this specific leg
    const legDeparture = new Date(departureDate.getTime() + elapsedMs)
    const hourOfDay  = legDeparture.getHours()        // 0–23
    const dayOfWeek  = legDeparture.getDay()           // 0 (Sun) – 6 (Sat)

    // Fetch speed profile from DB
    const rows = await query<SpeedProfileRow>(
      `SELECT avg_speed_kmh FROM speed_profiles
       WHERE org_id = $1 AND hour_of_day = $2 AND day_of_week = $3
       LIMIT 1`,
      [orgId, hourOfDay, dayOfWeek]
    )

    const speedKmh =
      rows.length > 0 && typeof rows[0].avg_speed_kmh === 'number' && rows[0].avg_speed_kmh > 0
        ? rows[0].avg_speed_kmh
        : defaultSpeedKmh

    // time (hours) = distance / speed → convert to minutes
    const legMinutes = (distanceKm / speedKmh) * 60

    breakdown.push({
      fromStop:         i,
      toStop:           i + 1,
      distanceKm,
      estimatedMinutes: legMinutes,
    })

    totalMinutes += legMinutes
    elapsedMs    += legMinutes * 60_000
  }

  // Derive ETA confidence intervals from the point estimate using a fixed spread.
  // Higher speed → shorter time, so p10 (optimistic) uses the faster-speed factor
  // and p90/p99 (pessimistic) use the slower-speed factors.
  const eta: ETAConfidenceInterval = {
    p10EtaMinutes: totalMinutes * 0.80,   // +20 % speed → 20 % shorter
    p50EtaMinutes: totalMinutes,           // median
    p90EtaMinutes: totalMinutes * 1.30,   // −23 % speed → 30 % longer
    p99EtaMinutes: totalMinutes * 1.60,   // −37.5 % speed → 60 % longer
  }

  return {
    estimatedMinutes: totalMinutes,
    eta,
    breakdown,
  }
}
