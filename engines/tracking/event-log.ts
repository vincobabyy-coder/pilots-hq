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
  }
}

/**
 * Append a single event to the log.
 * Returns the persisted event (with generated id and createdAt).
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
  const rows = await query<EventRow>(
    `INSERT INTO tracking_events (shipment_id, event_type, event_status, lat, lon, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, shipment_id, event_type, event_status, lat, lon, details, created_at`,
    [
      shipmentId,
      eventType,
      payload?.eventStatus ?? null,
      payload?.lat ?? null,
      payload?.lon ?? null,
      payload?.details != null ? JSON.stringify(payload.details) : null,
    ]
  )
  return rowToEvent(rows[0])
}

/**
 * Replay all events for a shipment in chronological order.
 */
export async function replayEvents(shipmentId: string): Promise<TrackingEvent[]> {
  const rows = await query<EventRow>(
    `SELECT id, shipment_id, event_type, event_status, lat, lon, details, created_at
     FROM tracking_events
     WHERE shipment_id = $1
     ORDER BY created_at ASC`,
    [shipmentId]
  )
  return rows.map(rowToEvent)
}
