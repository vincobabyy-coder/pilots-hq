import { createHash } from 'crypto'
import { query } from '../../core/db/pool'
import { TrackingEvent, TrackingEventType } from './types'

interface EventRow extends Record<string, unknown> {
  id: string
  shipment_id: string
  event_type: TrackingEventType
  event_status: string | null
  lat: number | null
  lon: number | null
  details: Record<string, unknown> | null
  created_at: Date
  event_hash: string | null
}

function rowToEvent(row: EventRow): TrackingEvent {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    eventType: row.event_type,
    ...(row.event_status != null && { eventStatus: row.event_status }),
    ...(row.lat != null && { lat: row.lat }),
    ...(row.lon != null && { lon: row.lon }),
    ...(row.details != null && { details: row.details }),
    createdAt: row.created_at,
    ...(row.event_hash != null && { eventHash: row.event_hash }),
  }
}

function computeEventHash(
  event: Omit<TrackingEvent, 'eventHash'>,
  previousHash: string
): string {
  const content = JSON.stringify({
    id: event.id,
    shipmentId: event.shipmentId,
    eventType: event.eventType,
    lat: event.lat,
    lon: event.lon,
    payload: event.details,
    createdAt: event.createdAt.toISOString(),
    previousHash,
  })
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Append a single event to the log.
 * Computes a SHA-256 hash chaining this event to the previous one,
 * making the log tamper-evident.
 * Returns the persisted event (with generated id, createdAt, and eventHash).
 */
export async function appendEvent(
  shipmentId: string,
  eventType: TrackingEventType,
  payload?: {
    eventStatus?: string
    lat?: number
    lon?: number
    details?: Record<string, unknown>
  }
): Promise<TrackingEvent> {
  // Fetch the most recent event for this shipment to chain hashes.
  const prevRows = await query<{ event_hash: string | null }>(
    `SELECT event_hash
     FROM tracking_events
     WHERE shipment_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [shipmentId]
  )
  const previousHash =
    prevRows.length > 0 && prevRows[0].event_hash != null
      ? prevRows[0].event_hash
      : 'genesis'

  // Insert the event first to get the database-generated id and created_at.
  const rows = await query<EventRow>(
    `INSERT INTO tracking_events (shipment_id, event_type, event_status, lat, lon, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, shipment_id, event_type, event_status, lat, lon, details, created_at, event_hash`,
    [
      shipmentId,
      eventType,
      payload?.eventStatus ?? null,
      payload?.lat ?? null,
      payload?.lon ?? null,
      payload?.details != null ? JSON.stringify(payload.details) : null,
    ]
  )
  const insertedEvent = rowToEvent(rows[0])

  // Compute the hash now that we have id and createdAt from the DB.
  const eventHash = computeEventHash(insertedEvent, previousHash)

  // Write the hash back.
  const updatedRows = await query<EventRow>(
    `UPDATE tracking_events
     SET event_hash = $1
     WHERE id = $2
     RETURNING id, shipment_id, event_type, event_status, lat, lon, details, created_at, event_hash`,
    [eventHash, insertedEvent.id]
  )
  return rowToEvent(updatedRows[0])
}

/**
 * Replay all events for a shipment in chronological order.
 */
export async function replayEvents(shipmentId: string): Promise<TrackingEvent[]> {
  const rows = await query<EventRow>(
    `SELECT id, shipment_id, event_type, event_status, lat, lon, details, created_at, event_hash
     FROM tracking_events
     WHERE shipment_id = $1
     ORDER BY created_at ASC`,
    [shipmentId]
  )
  return rows.map(rowToEvent)
}

/**
 * Verifies the entire event chain for a shipment.
 * Re-derives each event's hash from its content and the prior event's hash,
 * then compares against the stored eventHash.
 *
 * Returns:
 *   { valid: true, checkedCount }            — chain is intact
 *   { valid: false, firstTamperedEventId, checkedCount } — first broken link found
 */
export async function verifyEventChain(shipmentId: string): Promise<{
  valid: boolean
  firstTamperedEventId?: string
  checkedCount: number
}> {
  const events = await replayEvents(shipmentId)

  let previousHash = 'genesis'

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const { eventHash, ...eventWithoutHash } = event
    const recomputed = computeEventHash(eventWithoutHash, previousHash)

    if (recomputed !== eventHash) {
      return {
        valid: false,
        firstTamperedEventId: event.id,
        checkedCount: i,
      }
    }

    // Advance the chain — safe to assert non-null because we just confirmed it matches.
    previousHash = eventHash as string
  }

  return { valid: true, checkedCount: events.length }
}
