import { describe, it, expect } from '../runner'
import { reduceEvents } from '../../engines/tracking/state-machine'
import { TrackingEvent, TrackingEventType } from '../../engines/tracking/types'

function makeEvent(type: TrackingEventType, overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    id: 'evt-' + Math.random(),
    shipmentId: 'shp-test',
    eventType: type,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('tracking state machine', () => {
  it('empty event list returns initial state', () => {
    // Pass now = new Date(0) so the epoch lastUpdatedAt is not considered late
    // (no time has elapsed between lastUpdatedAt and now)
    const state = reduceEvents('shp-1', [], new Date(0))
    expect(state.status).toBe('created')
    expect(state.eventCount).toBe(0)
    expect(state.isLate).toBe(false)
  })

  it('status follows last event type', () => {
    const events = [
      makeEvent('created'),
      makeEvent('in_transit'),
    ]
    const state = reduceEvents('shp-test', events)
    expect(state.status).toBe('in_transit')
    expect(state.eventCount).toBe(2)
  })

  it('location_updated sets lastLat and lastLon', () => {
    const events = [
      makeEvent('location_updated', { lat: 6.5244, lon: 3.3792 }),
    ]
    const state = reduceEvents('shp-test', events)
    expect(state.lastLat).toBe(6.5244)
    expect(state.lastLon).toBe(3.3792)
  })

  it('delivered sets deliveredAt', () => {
    const deliveredAt = new Date('2024-01-15T12:00:00Z')
    const events = [
      makeEvent('created'),
      makeEvent('delivered', { createdAt: deliveredAt }),
    ]
    const state = reduceEvents('shp-test', events)
    expect(state.deliveredAt?.toISOString()).toBe(deliveredAt.toISOString())
  })

  it('exception event sets isException', () => {
    const events = [
      makeEvent('created'),
      makeEvent('exception'),
    ]
    const state = reduceEvents('shp-test', events)
    expect(state.isException).toBe(true)
  })

  it('isLate is true when last update > 2 hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const event = makeEvent('created', { createdAt: threeHoursAgo })
    const state = reduceEvents('shp', [event], new Date())
    expect(state.isLate).toBe(true)
  })

  it('isLate is false for delivered shipment regardless of time', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000)
    const event = makeEvent('delivered', { createdAt: fiveHoursAgo })
    const state = reduceEvents('shp', [event], new Date())
    expect(state.isLate).toBe(false)
  })
})
