import { query, queryOne, transaction } from '../../core/db/pool'
import { recordEvent } from '../../engines/tracking/commands'
import { getCurrentState, getEventLog } from '../../engines/tracking/queries'
import { TrackingEvent, ShipmentState } from '../../engines/tracking/types'
import { logger } from '../../core/logger/logger'

export interface CreateShipmentInput {
  orgId: string
  orderIds: string[]
  originWarehouseId?: string
  destinationAddress: Record<string, unknown>
  destLat?: number
  destLon?: number
  estimatedDelivery?: string  // ISO timestamp
}

export interface ShipmentRow extends Record<string, unknown> {
  id: string
  orgId: string
  shipmentNumber: string
  originWarehouseId: string | null
  destinationAddress: unknown
  destLat: number | null
  destLon: number | null
  status: string
  assignedRouteId: string | null
  assignedDriverId: string | null
  estimatedDelivery: string | null
  actualDelivery: string | null
  exceptionFlag: boolean
  exceptionReason: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(message: string, code: string, statusCode: number): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string }
  err.statusCode = statusCode
  err.code = code
  return err
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

export async function createShipment(input: CreateShipmentInput): Promise<ShipmentRow> {
  const shipmentNumber = 'SHP-' + Date.now()

  const shipment = await transaction(async (client) => {
    // 1. INSERT shipment
    const rows = await client.query<ShipmentRow>(
      `INSERT INTO shipments
         (org_id, shipment_number, origin_warehouse_id, destination_address, dest_lat, dest_lon, status, estimated_delivery)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'pending', $7)
       RETURNING *`,
      [
        input.orgId,
        shipmentNumber,
        input.originWarehouseId ?? null,
        JSON.stringify(input.destinationAddress),
        input.destLat ?? null,
        input.destLon ?? null,
        input.estimatedDelivery ?? null,
      ]
    )
    const newShipment = rows[0]

    // 2. INSERT shipment_orders for each orderId
    for (const orderId of input.orderIds) {
      await client.query(
        'INSERT INTO shipment_orders (shipment_id, order_id) VALUES ($1, $2)',
        [newShipment.id, orderId]
      )
    }

    return newShipment
  })

  // 3. Record 'created' tracking event (outside transaction — fail-open)
  await recordEvent(shipment.id, 'created', { details: { orderIds: input.orderIds } })

  logger.info('Shipment created', { orgId: input.orgId, shipmentId: shipment.id, shipmentNumber })
  return shipment
}

export async function getShipment(orgId: string, shipmentId: string): Promise<ShipmentRow | null> {
  return queryOne<ShipmentRow>(
    'SELECT * FROM shipments WHERE id = $1 AND org_id = $2',
    [shipmentId, orgId]
  )
}

export interface ListShipmentsFilters {
  status?: string
  page?: number
  limit?: number
}

export async function listShipments(
  orgId: string,
  filters: ListShipmentsFilters = {}
): Promise<{ shipments: ShipmentRow[]; total: number }> {
  const page = filters.page ?? 1
  const limit = filters.limit ?? 20
  const offset = (page - 1) * limit

  let rows: Array<ShipmentRow & { total_count?: string }>

  if (filters.status) {
    rows = await query<ShipmentRow & { total_count?: string }>(
      `SELECT *, COUNT(*) OVER() AS total_count
       FROM shipments
       WHERE org_id = $1 AND status = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [orgId, filters.status, limit, offset]
    )
  } else {
    rows = await query<ShipmentRow & { total_count?: string }>(
      `SELECT *, COUNT(*) OVER() AS total_count
       FROM shipments
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    )
  }

  const total = rows.length > 0 ? parseInt(rows[0].total_count as string, 10) : 0

  // Strip the synthetic total_count column before returning
  const shipments = rows.map(({ total_count: _tc, ...rest }) => rest as ShipmentRow)

  return { shipments, total }
}

export async function getShipmentState(orgId: string, shipmentId: string): Promise<ShipmentState | null> {
  const shipment = await getShipment(orgId, shipmentId)
  if (!shipment) throw makeError('Shipment not found', 'SHIPMENT_NOT_FOUND', 404)
  return getCurrentState(shipmentId)
}

export async function getShipmentEvents(orgId: string, shipmentId: string): Promise<TrackingEvent[]> {
  const shipment = await getShipment(orgId, shipmentId)
  if (!shipment) throw makeError('Shipment not found', 'SHIPMENT_NOT_FOUND', 404)
  return getEventLog(shipmentId)
}

export async function markException(
  orgId: string,
  shipmentId: string,
  reason: string
): Promise<ShipmentRow> {
  // 1. Fetch shipment — 404 if missing
  const shipment = await getShipment(orgId, shipmentId)
  if (!shipment) throw makeError('Shipment not found', 'SHIPMENT_NOT_FOUND', 404)

  // 2. Record exception event
  await recordEvent(shipmentId, 'exception', { details: { reason } })

  // 3. Update shipment row
  const rows = await query<ShipmentRow>(
    `UPDATE shipments
     SET exception_flag = true, exception_reason = $1, updated_at = NOW()
     WHERE id = $2 AND org_id = $3
     RETURNING *`,
    [reason, shipmentId, orgId]
  )

  logger.info('Shipment exception flagged', { orgId, shipmentId, reason })
  return rows[0]
}

export async function updateDriverLocation(
  orgId: string,
  driverId: string,
  lat: number,
  lon: number
): Promise<void> {
  // 1. Update driver's current coordinates
  await query(
    'UPDATE drivers SET current_lat = $1, current_lon = $2, updated_at = NOW() WHERE id = $3 AND org_id = $4',
    [lat, lon, driverId, orgId]
  )

  // 2. Find all active shipments for this driver
  const activeShipments = await query<{ id: string }>(
    `SELECT id FROM shipments
     WHERE assigned_driver_id = $1 AND org_id = $2 AND status IN ('in_transit', 'out_for_delivery')`,
    [driverId, orgId]
  )

  // 3. Record location_updated event for each active shipment
  for (const { id: shipmentId } of activeShipments) {
    await recordEvent(shipmentId, 'location_updated', { lat, lon })
  }

  logger.info('Driver location updated', { orgId, driverId, lat, lon, activeShipments: activeShipments.length })
}
