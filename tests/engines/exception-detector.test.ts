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
  // ── Backward-compat: original tests ─────────────────────────────────────

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
    // ~1 km apart
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

  // ── Phase 2.1: new structured-exception tests ────────────────────────────

  it('no exceptions → items is empty, highestSeverity is 0', () => {
    const state = makeState({ lastUpdatedAt: new Date() })
    const result = detectExceptions(state, [], new Date())
    expect(result.isException).toBe(false)
    expect(result.items).toHaveLength(0)
    expect(result.highestSeverity).toBe(0)
  })

  it('overdue → severity 3, has rootCausehypothesis and recommendedAction', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const state = makeState({ status: 'in_transit', lastUpdatedAt: threeHoursAgo })
    const result = detectExceptions(state, [], new Date())
    // items is non-empty (overdue fires)
    expect(result.items.length > 0).toBeTruthy()
    const overdueItem = result.items.find(i => i.reason.toLowerCase().includes('overdue'))
    expect(overdueItem).toBeTruthy()
    expect(overdueItem!.severity).toBe(3)
    // rootCausehypothesis is a non-empty string
    expect(overdueItem!.rootCausehypothesis).toBeTruthy()
    // recommendedAction is a non-empty string
    expect(overdueItem!.recommendedAction).toBeTruthy()
  })

  it('stale location → severity 2, correct rootCause and recommendedAction', () => {
    const fiftyMinutesAgo = new Date(Date.now() - 50 * 60 * 1000)
    const state = makeState({ lastUpdatedAt: new Date() })
    const events: TrackingEvent[] = [makeLocationEvent(6.5, 3.3, fiftyMinutesAgo)]
    const result = detectExceptions(state, events, new Date())
    const staleItem = result.items.find(i => i.reason.includes('45'))
    expect(staleItem).toBeTruthy()
    expect(staleItem!.severity).toBe(2)
    // rootCause mentions GPS connectivity
    const rootCauseLower = staleItem!.rootCausehypothesis.toLowerCase()
    expect(rootCauseLower.includes('gps')).toBeTruthy()
    // recommendedAction mentions contacting driver
    const actionLower = staleItem!.recommendedAction.toLowerCase()
    expect(actionLower.includes('driver')).toBeTruthy()
  })

  it('location jump → severity 3, rootCause mentions GPS spoofing', () => {
    const t0 = new Date(Date.now() - 6 * 60 * 1000)
    const t1 = new Date(Date.now() - 1 * 60 * 1000)
    const events: TrackingEvent[] = [
      makeLocationEvent(51.5074, -0.1278, t0), // London
      makeLocationEvent(48.8566, 2.3522, t1),  // Paris
    ]
    const state = makeState({ lastUpdatedAt: t1 })
    const result = detectExceptions(state, events, new Date())
    const jumpItem = result.items.find(
      i => i.reason.toLowerCase().includes('anomaly') || i.reason.toLowerCase().includes('jump')
    )
    expect(jumpItem).toBeTruthy()
    expect(jumpItem!.severity).toBe(3)
    const rootCauseLower = jumpItem!.rootCausehypothesis.toLowerCase()
    expect(rootCauseLower.includes('gps spoofing')).toBeTruthy()
  })

  it('multiple exceptions → highestSeverity equals max of all severities', () => {
    // Trigger both overdue (sev 3) and stale location (sev 2) simultaneously.
    // State updated 3 hours ago → overdue fires.
    // Location event 50 minutes ago → stale fires.
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const fiftyMinutesAgo = new Date(Date.now() - 50 * 60 * 1000)
    const state = makeState({ status: 'in_transit', lastUpdatedAt: threeHoursAgo })
    const events: TrackingEvent[] = [makeLocationEvent(6.5, 3.3, fiftyMinutesAgo)]
    const result = detectExceptions(state, events, new Date())
    // Both overdue and stale should fire → at least 2 items
    expect(result.items.length >= 2).toBeTruthy()
    // highestSeverity must equal the maximum severity across all items
    const computedMax = result.items.reduce((m, i) => (i.severity > m ? i.severity : m), 0)
    expect(result.highestSeverity).toBe(computedMax)
    // overdue is sev 3, so highest must be 3
    expect(result.highestSeverity).toBe(3)
  })

  it('reasons[] is always in sync with items.map(i => i.reason)', () => {
    // Test with overdue scenario so we have at least one item.
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const state = makeState({ status: 'in_transit', lastUpdatedAt: threeHoursAgo })
    const result = detectExceptions(state, [], new Date())
    const derivedReasons = result.items.map(i => i.reason)
    expect(result.reasons).toEqual(derivedReasons)
  })

  it('reasons[] is in sync with items when there are no exceptions', () => {
    const state = makeState({ lastUpdatedAt: new Date() })
    const result = detectExceptions(state, [], new Date())
    expect(result.reasons).toEqual(result.items.map(i => i.reason))
    expect(result.reasons).toHaveLength(0)
  })
})
