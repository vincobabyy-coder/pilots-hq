import { describe, it, expect } from '../runner'
import { haversineKm, travelTimeMinutes } from '../../engines/route-optimizer/distance-matrix'

describe('distance-matrix', () => {
  it('haversineKm — London to Paris is approximately 340 km', () => {
    const dist = haversineKm(51.5074, -0.1278, 48.8566, 2.3522)
    expect(dist > 330 && dist < 350).toBe(true)
  })

  it('haversineKm — same point returns 0', () => {
    expect(haversineKm(10, 10, 10, 10)).toBe(0)
  })

  it('travelTimeMinutes — falls back to 40 km/h with no profile', async () => {
    // Use a valid UUID that will not match any speed_profile row → triggers 40 km/h fallback
    const minutes = await travelTimeMinutes('00000000-0000-0000-0000-000000000000', 0, 0, 0, 0.3597, 9, 1)
    // At 40 km/h, ~40 km ≈ 60 minutes
    expect(minutes > 55 && minutes < 65).toBe(true)
  })

  it('travelTimeMinutes — throws on invalid departureHour', async () => {
    await expect(() => travelTimeMinutes('org', 0, 0, 0, 0, 25, 1)).toReject()
  })
})
