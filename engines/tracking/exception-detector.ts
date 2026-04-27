import { TrackingEvent, ShipmentState } from './types'
import { haversineKm } from '../route-optimizer/distance-matrix'

export interface ExceptionResult {
  isException: boolean
  reasons: string[]
}

/**
 * Run exception detection for a shipment.
 * Called after every location_updated event.
 *
 * @param state     Current shipment state (from reduceEvents)
 * @param events    Full event history (chronological)
 * @param now       Current time (defaults to new Date())
 */
export function detectExceptions(
  state: ShipmentState,
  events: TrackingEvent[],
  now: Date = new Date()
): ExceptionResult {
  const reasons: string[] = []

  // Check 1 — Delivery overdue (> 2 hours late)
  if (
    state.status !== 'delivered' &&
    state.status !== 'cancelled' &&
    state.lastUpdatedAt.getTime() > 0 &&
    now.getTime() - state.lastUpdatedAt.getTime() > 2 * 60 * 60 * 1000
  ) {
    reasons.push('Delivery overdue by more than 2 hours')
  }

  // Check 2 — Stale location (no location_updated event in 45 minutes)
  const lastLocationEvent = [...events]
    .reverse()
    .find(e => e.eventType === 'location_updated')

  if (lastLocationEvent) {
    const staleMs = 45 * 60 * 1000
    if (now.getTime() - lastLocationEvent.createdAt.getTime() > staleMs) {
      reasons.push('No location update in 45 minutes')
    }
  }

  // Check 3 — Location anomaly (position jump > 50 km in < 10 minutes)
  const locationEvents = events.filter(
    e => e.eventType === 'location_updated' && e.lat != null && e.lon != null
  )
  if (locationEvents.length >= 2) {
    const prev = locationEvents[locationEvents.length - 2]
    const curr = locationEvents[locationEvents.length - 1]
    const timeDiffMs = curr.createdAt.getTime() - prev.createdAt.getTime()
    const distKm = haversineKm(prev.lat!, prev.lon!, curr.lat!, curr.lon!)
    if (distKm > 50 && timeDiffMs < 10 * 60 * 1000) {
      reasons.push(
        `Location anomaly: ${distKm.toFixed(1)} km jump in ${(timeDiffMs / 60000).toFixed(1)} minutes`
      )
    }
  }

  return { isException: reasons.length > 0, reasons }
}
