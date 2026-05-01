import { TrackingEvent, ShipmentState } from './types'
import { haversineKm } from '../route-optimizer/distance-matrix'

export interface ExceptionItem {
  reason: string
  severity: 1 | 2 | 3          // 1 = info, 2 = warning, 3 = critical
  rootCausehypothesis: string   // plain-English hypothesis
  recommendedAction: string     // what operator should do
}

export interface ExceptionResult {
  isException: boolean
  reasons: string[]              // kept for backward compat (derived from items)
  items: ExceptionItem[]         // structured exceptions
  highestSeverity: 1 | 2 | 3 | 0   // 0 if no exceptions
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
  const items: ExceptionItem[] = []

  // Check 1 — Delivery overdue (> 2 hours late)
  if (
    state.status !== 'delivered' &&
    state.status !== 'cancelled' &&
    state.lastUpdatedAt.getTime() > 0 &&
    now.getTime() - state.lastUpdatedAt.getTime() > 2 * 60 * 60 * 1000
  ) {
    items.push({
      reason: 'Delivery overdue by more than 2 hours',
      severity: 3,
      rootCausehypothesis: 'Vehicle may be broken down or severely lost',
      recommendedAction:
        'Contact driver immediately and dispatch backup vehicle if no response in 15 min',
    })
  }

  // Check 2 — Stale location (no location_updated event in 45 minutes)
  const lastLocationEvent = [...events]
    .reverse()
    .find(e => e.eventType === 'location_updated')

  if (lastLocationEvent) {
    const staleMs = 45 * 60 * 1000
    if (now.getTime() - lastLocationEvent.createdAt.getTime() > staleMs) {
      items.push({
        reason: 'No location update in 45 minutes',
        severity: 2,
        rootCausehypothesis: 'GPS/app connectivity issue or unauthorized stop',
        recommendedAction:
          'Attempt to contact driver; if unreachable after 20 min, escalate to dispatch supervisor',
      })
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
      items.push({
        reason: `Location anomaly: ${distKm.toFixed(1)} km jump in ${(timeDiffMs / 60000).toFixed(1)} minutes`,
        severity: 3,
        rootCausehypothesis: 'Possible GPS spoofing, vehicle theft, or data corruption',
        recommendedAction:
          'Halt payment release for this shipment and trigger immediate security review',
      })
    }
  }

  const reasons = items.map(i => i.reason)
  const highestSeverity: 0 | 1 | 2 | 3 =
    items.length === 0
      ? 0
      : (Math.max(...items.map(i => i.severity)) as 1 | 2 | 3)

  return {
    isException: items.length > 0,
    reasons,
    items,
    highestSeverity,
  }
}
