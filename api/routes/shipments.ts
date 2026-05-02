import { Router } from '../../core/http/router'
import * as shipmentService from '../services/shipment.service'
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../core/constants'
import { eventBus } from '../../core/events/event-bus'
import { updateSpeedProfile } from '../../engines/route-optimizer/distance-matrix'
import { query } from '../../core/db/pool'
import { recordEvent } from '../../engines/tracking/commands'
import { logger } from '../../core/logger/logger'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(
  err: unknown,
  res: { status: (code: number) => { fail: (code: string, msg: string, status: number) => void } }
): void {
  const e = err as { statusCode?: number; code?: string; message?: string }
  if (e.statusCode) {
    res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
    return
  }
  throw err
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function shipmentsRouter(): Router {
  const router = new Router()

  // POST / — create shipment
  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // Validate orderIds — required non-empty array of strings
    if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'orderIds must be a non-empty array', 400); return
    }
    if (!body.orderIds.every((x: unknown) => typeof x === 'string')) {
      res.status(400).fail('VALIDATION_ERROR', 'orderIds must be an array of strings', 400); return
    }

    // Validate destinationAddress — required object
    if (
      body.destinationAddress === undefined ||
      body.destinationAddress === null ||
      typeof body.destinationAddress !== 'object' ||
      Array.isArray(body.destinationAddress)
    ) {
      res.status(400).fail('VALIDATION_ERROR', 'destinationAddress is required and must be an object', 400); return
    }

    // Optional numeric fields
    if (body.destLat !== undefined && typeof body.destLat !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'destLat must be a number', 400); return
    }
    if (body.destLon !== undefined && typeof body.destLon !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'destLon must be a number', 400); return
    }
    if (body.originWarehouseId !== undefined && typeof body.originWarehouseId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'originWarehouseId must be a string', 400); return
    }
    if (body.estimatedDelivery !== undefined && typeof body.estimatedDelivery !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'estimatedDelivery must be a string', 400); return
    }

    try {
      const shipment = await shipmentService.createShipment({
        orgId: req.orgId!,
        orderIds: body.orderIds as string[],
        originWarehouseId: body.originWarehouseId as string | undefined,
        destinationAddress: body.destinationAddress as Record<string, unknown>,
        destLat: body.destLat as number | undefined,
        destLon: body.destLon as number | undefined,
        estimatedDelivery: body.estimatedDelivery as string | undefined,
      })
      res.status(201).ok({ shipment })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET / — list shipments
  router.get('/', async (req, res) => {
    const query = req.query as Record<string, string>

    const status = query.status
    const page = query.page ? parseInt(query.page, 10) : 1
    const rawLimit = query.limit ? parseInt(query.limit, 10) : DEFAULT_PAGE_LIMIT
    const limit = Math.min(rawLimit, MAX_PAGE_LIMIT)

    try {
      const { shipments, total } = await shipmentService.listShipments(req.orgId!, { status, page, limit })
      res.ok({ shipments, total, page, limit })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /:id — get single shipment
  router.get('/:id', async (req, res) => {
    try {
      const shipment = await shipmentService.getShipment(req.orgId!, req.params.id)
      if (!shipment) {
        res.status(404).fail('SHIPMENT_NOT_FOUND', 'Shipment not found', 404); return
      }
      res.ok({ shipment })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /:id/location — polling fallback: most recent location_updated event
  router.get('/:id/location', async (req, res) => {
    const shipmentId = req.params.id

    // Validate shipment ID is a valid UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(shipmentId)) {
      res.status(400).fail('VALIDATION_ERROR', 'shipment id must be a valid UUID', 400); return
    }

    try {
      // Query most recent location_updated event for this shipment, scoped to the org
      const rows = await query<{ lat: number | null; lon: number | null; created_at: string }>(
        `SELECT te.lat, te.lon, te.created_at
         FROM tracking_events te
         JOIN shipments s ON s.id = te.shipment_id
         WHERE te.shipment_id = $1
           AND s.org_id        = $2
           AND te.event_type   = 'location_updated'
         ORDER BY te.created_at DESC
         LIMIT 1`,
        [shipmentId, req.orgId!]
      )

      if (rows.length === 0) {
        res.ok({
          data: {
            shipmentId,
            lat:            null,
            lon:            null,
            updatedAt:      null,
            connectionHint: 'websocket-preferred',
          },
        })
        return
      }

      const row = rows[0]
      res.ok({
        data: {
          shipmentId,
          lat:            row.lat,
          lon:            row.lon,
          updatedAt:      row.created_at,
          connectionHint: 'websocket-preferred',
        },
      })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /:id/events — event log
  router.get('/:id/events', async (req, res) => {
    try {
      const events = await shipmentService.getShipmentEvents(req.orgId!, req.params.id)
      res.ok({ events })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // POST /:id/events — append a tracking event
  router.post('/:id/events', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const id = req.params.id

    if (!body.event_type || typeof body.event_type !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'event_type is required and must be a string', 400); return
    }

    try {
      const event = await recordEvent(id, body.event_type as import('../../engines/tracking/types').TrackingEventType, {
        eventStatus: body.event_status as string | undefined,
        lat: body.lat as number | undefined,
        lon: body.lon as number | undefined,
        details: body.details as Record<string, unknown> | undefined,
      })

      if ((body as Record<string, unknown>).event_type === 'delivered') {
        eventBus.emit('shipment.delivered', {
          shipmentId: id,
          orgId: req.orgId!,
          deliveredAt: new Date().toISOString(),
        })
      }

      res.status(201).ok({ event })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // PATCH /:id/exception — mark exception
  router.patch('/:id/exception', async (req, res) => {
    const body = req.body as Record<string, unknown>

    if (!body.reason || typeof body.reason !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'reason is required and must be a string', 400); return
    }

    try {
      const shipment = await shipmentService.markException(
        req.orgId!,
        req.params.id,
        body.reason as string
      )
      res.ok({ shipment })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  return router
}

// ---------------------------------------------------------------------------
// Speed-profile listener — registered once at module load
// ---------------------------------------------------------------------------

eventBus.on('shipment.delivered', async ({ shipmentId, orgId }) => {
  try {
    const rows = await query(
      `SELECT r.stops, r.started_at, r.completed_at
       FROM routes r
       JOIN shipments s ON s.assigned_route_id = r.id
       WHERE s.id = $1 AND s.org_id = $2
         AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL`,
      [shipmentId, orgId]
    )
    if (rows.length === 0) return
    const route = rows[0] as { stops: unknown; started_at: string; completed_at: string }
    const stops: Array<{ lat: number; lon: number }> =
      typeof route.stops === 'string' ? JSON.parse(route.stops) : (route.stops as Array<{ lat: number; lon: number }>)
    if (!Array.isArray(stops) || stops.length < 2) return

    const startedAt = new Date(route.started_at)
    const totalMinutes =
      (new Date(route.completed_at).getTime() - startedAt.getTime()) / 60_000
    const minutesPerLeg = totalMinutes / (stops.length - 1)

    // Derive hour and day-of-week from route start time for the speed profile cell
    const hourOfDay = startedAt.getUTCHours()
    const dayOfWeek = startedAt.getUTCDay()

    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i]
      const to = stops[i + 1]
      // Haversine distance in km
      const R = 6371
      const lat1Rad = (from.lat * Math.PI) / 180
      const lat2Rad = (to.lat * Math.PI) / 180
      const dLat = ((to.lat - from.lat) * Math.PI) / 180
      const dLon = ((to.lon - from.lon) * Math.PI) / 180
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
      const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      if (minutesPerLeg <= 0 || distanceKm <= 0) continue
      const observedSpeedKmh = (distanceKm / minutesPerLeg) * 60
      await updateSpeedProfile(orgId, hourOfDay, dayOfWeek, observedSpeedKmh)
    }

    logger.info('Speed profile updated', { shipmentId, orgId })
  } catch (err) {
    logger.warn('Speed profile update failed', { shipmentId, error: (err as Error).message })
  }
})
