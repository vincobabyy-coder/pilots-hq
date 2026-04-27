import { query, queryOne } from '../../core/db/pool'

export interface SpeedProfile {
  orgId: string
  hourOfDay: number
  dayOfWeek: number
  avgSpeedKmh: number
  sampleCount: number
}

/**
 * Haversine great-circle distance between two lat/lon points, in kilometres.
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371 // Earth mean radius in km

  // Convert degrees to radians
  const lat1Rad = (lat1 * Math.PI) / 180
  const lat2Rad = (lat2 * Math.PI) / 180
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  // Haversine formula
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c

  return distance
}

/**
 * Estimated travel time in minutes between two points.
 * Uses the org's speed profile for (hourOfDay, dayOfWeek).
 * Falls back to 40 km/h if no profile row exists.
 */
export async function travelTimeMinutes(
  orgId: string,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  departureHour: number, // 0–23
  dayOfWeek: number // 0 = Sunday … 6 = Saturday
): Promise<number> {
  const distanceKm = haversineKm(lat1, lon1, lat2, lon2)

  // Query speed profile
  const profile = await queryOne<{
    org_id: string
    hour_of_day: number
    day_of_week: number
    avg_speed_kmh: number
    sample_count: number
  }>(
    'SELECT org_id, hour_of_day, day_of_week, avg_speed_kmh, sample_count FROM speed_profiles WHERE org_id = $1 AND hour_of_day = $2 AND day_of_week = $3',
    [orgId, departureHour, dayOfWeek]
  )

  const speedKmh = profile?.avg_speed_kmh ?? 40.0
  const timeMinutes = (distanceKm / speedKmh) * 60

  return timeMinutes
}

/**
 * Incrementally update the speed profile for a (hour, day) cell.
 * Uses a weighted running average:
 *   new_avg = (old_avg * sample_count + observed) / (sample_count + 1)
 * Upserts the row (INSERT … ON CONFLICT DO UPDATE).
 */
export async function updateSpeedProfile(
  orgId: string,
  hourOfDay: number,
  dayOfWeek: number,
  observedSpeedKmh: number
): Promise<void> {
  await query(
    `INSERT INTO speed_profiles (org_id, hour_of_day, day_of_week, avg_speed_kmh, sample_count)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (org_id, hour_of_day, day_of_week) DO UPDATE SET
       avg_speed_kmh = (speed_profiles.avg_speed_kmh * speed_profiles.sample_count + EXCLUDED.avg_speed_kmh)
                       / (speed_profiles.sample_count + 1),
       sample_count = speed_profiles.sample_count + 1,
       updated_at = NOW()`,
    [orgId, hourOfDay, dayOfWeek, observedSpeedKmh]
  )
}
