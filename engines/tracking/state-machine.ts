import { TrackingEvent, ShipmentState, TrackingEventType } from './types'

/**
 * Reduce a sequence of events to current shipment state.
 * Pure function — deterministic given the same event sequence.
 */
export function reduceEvents(
  shipmentId: string,
  events: TrackingEvent[],
  now: Date = new Date()
): ShipmentState {
  const state: ShipmentState = {
    shipmentId,
    status: 'created' as TrackingEventType,
    lastUpdatedAt: new Date(0),
    eventCount: 0,
    isLate: false,
    isException: false,
  }

  for (const event of events) {
    // Always apply these fields
    state.status = event.eventType
    state.lastUpdatedAt = event.createdAt
    state.eventCount++

    switch (event.eventType) {
      case 'location_updated':
        if (event.lat != null) state.lastLat = event.lat
        if (event.lon != null) state.lastLon = event.lon
        break
      case 'delivered':
        state.deliveredAt = event.createdAt
        break
      case 'exception':
        state.isException = true
        break
      // cancelled: no additional changes beyond status update
    }
  }

  // Late detection: not delivered, not cancelled, and no update in > 2 hours
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000
  if (
    state.status !== 'delivered' &&
    state.status !== 'cancelled' &&
    now.getTime() - state.lastUpdatedAt.getTime() > TWO_HOURS_MS
  ) {
    state.isLate = true
  }

  return state
}
