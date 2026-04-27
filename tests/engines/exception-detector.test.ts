import { describe, it, expect } from '../runner'
import { detectExceptions } from '../../engines/tracking/exception-detector'
import { ShipmentState, TrackingEvent, TrackingEventType } from '../../engines/tracking/types'

function makeState(overrides: Partial<ShipmentState> = {}): ShipmentState {
  return {
    shipmentId: 'shp-test',
    status: 'in_transit',
    lastUpdatedAt: new Date(),
    eventCount: 1,
    isLate: false,
    isException: false,
    ...overrides,
  }
}

function makeLocationEvent(lat: number, lon: number, createdAt: Date): TrackingEvent {
  return {
    id: 'evt-' + Math.random(),
    shipmentId: 'shp-test',
    eventType: 'location_updated',
    lat,
    lon,
    createdAt,
  }
}

describe('exception detector', () => {
  it('no exceptions on fresh in-transit shipment', () => {
    const state = makeState({ lastUpdatedAt: new Date() })
    const result = detectExceptions(state, [], new Date())
    expect(result.isException).toBe(false)
    expect(result.reasons.length).toBe(0)
  })

  it('overdue: flags when status not delivered and > 2 hours since last update', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const state = makeState({ status: 'in_transit', lastUpdatedAt: threeHoursAgo })
    const result = detectExceptions(state, [], new Date())
    expect(result.isException).toBe(true)
    // At least one reason mentions overdue
    const hasOverdue = result.reasons.some(r => r.toLowerCase().includes('overdue'))
    expect(hasOverdue).toBeTruthy()
  })

  it('overdue: does not flag delivered shipments', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000)
    const state = makeState({ status: 'delivered', lastUpdatedAt: fiveHoursAgo })
    const result = detectExceptions(state, [], new Date())
    expect(result.isException).toBe(false)
  })

  it('stale: flags when last location_updated > 45 minutes ago', () => {
    const fiftyMinutesAgo = new Date(Date.now() - 50 * 60 * 1000)
    // State updated recently so overdue doesn't fire
    const state = makeState({ lastUpdatedAt: new Date() })
    const events: TrackingEvent[] = [makeLocationEvent(6.5, 3.3, fiftyMinutesAgo)]
    const result = detectExceptions(state, events, new Date())
    const hasStale = result.reasons.some(r => r.includes('45'))
    expect(hasStale).toBeTruthy()
  })

  it('stale: no flag when location was updated recently', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const state = makeState({ lastUpdatedAt: tenMinutesAgo })
    const events: TrackingEvent[] = [makeLocationEvent(6.5, 3.3, tenMinutesAgo)]
    const result = detectExceptions(state, events, new Date())
    const hasStale = result.reasons.some(r => r.includes('45'))
    expect(hasStale).toBeFalsy()
  })

  it('location anomaly: flags > 50 km jump in < 10 min', () => {
    const t0 = new Date(Date.now() - 6 * 60 * 1000) // 6 minutes ago
    const t1 = new Date(Date.now() - 1 * 60 * 1000) // 1 minute ago
    // London to Paris — ~341 km apart
    const events: TrackingEvent[] = [
      makeLocationEvent(51.5074, -0.1278, t0), // London
      makeLocationEvent(48.8566, 2.3522, t1),  // Paris
    ]
    const state = makeState({ lastUpdatedAt: t1 })
    const result = detectExceptions(state, events, new Date())
    expect(result.isException).toBe(true)
    const hasAnomaly = result.reasons.some(
      r => r.toLowerCase().includes('anomaly') || r.toLowerCase().includes('jump')
    )
    expect(hasAnomaly).toBeTruthy()
  })

  it('location anomaly: no flag for reasonable movement', () => {
    const t0 = new Date(Date.now() - 3 * 60 * 1000) // 3 minutes ago
    const t1 = new Date(Date.now() - 1 * 60 * 1000) // 1 minute ago
    // ~1 km apart (roughly 0.009 degrees latitude)
    const events: TrackingEvent[] = [
      makeLocationEvent(6.5244, 3.3792, t0),
      makeLocationEvent(6.5334, 3.3792, t1),
    ]
    const state = makeState({ lastUpdatedAt: t1 })
    const result = detectExceptions(state, events, new Date())
    const hasAnomaly = result.reasons.some(
      r => r.toLowerCase().includes('anomaly') || r.toLowerCase().includes('jump')
    )
    expect(hasAnomaly).toBeFalsy()
  })
})
