import { query, queryOne } from '../../core/db/pool'
import { enqueue, getJob, Job } from '../../core/queue/simple-queue'
import { solveVRP } from '../../engines/route-optimizer/vrp'
import { SolverInput, Stop, Vehicle, RouteStop } from '../../engines/route-optimizer/types'
import { updateSpeedProfile } from '../../engines/route-optimizer/distance-matrix'
import { logger } from '../../core/logger/logger'

export interface OptimizeRequest {
  warehouseId: string
  date: string           // ISO date: 'YYYY-MM-DD'
  vehicleIds: string[]   // vehicles to use
  orderIds: string[]     // orders to route
}

export interface RouteRow extends Record<string, unknown> {
  id: string
  orgId: string
  routeNumber: string
  date: string
  driverId: string | null
  vehicleId: string | null
  status: string
  originWarehouseId: string | null
  stops: unknown
  totalDistanceKm: number | null
  estimatedDurationMinutes: number | null
  actualDurationMinutes: number | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CompleteRouteRequest {
  startedAt: string           // ISO 8601 datetime when the route departed the warehouse
  stopActualArrivalMinutes: number[]  // one entry per stop: actual minutes elapsed from route start
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

export async function optimizeRoutes(orgId: string, req: OptimizeRequest): Promise<string> {
  const { warehouseId, date, vehicleIds, orderIds } = req

  // 1. Validate warehouse belongs to org
  const warehouse = await queryOne<{ id: string; lat: number; lon: number }>(
    'SELECT id, lat, lon FROM warehouses WHERE id = $1 AND org_id = $2',
    [warehouseId, orgId]
  )
  if (!warehouse) throw makeError('Warehouse not found', 'WAREHOUSE_NOT_FOUND', 404)

  // 2. Validate all vehicles belong to org
  const vehicles = await query<{ id: string; capacity_kg: number; capacity_cbm: number }>(
    'SELECT id, capacity_kg, capacity_cbm FROM vehicles WHERE id = ANY($1) AND org_id = $2',
    [vehicleIds, orgId]
  )
  if (vehicles.length !== vehicleIds.length) {
    throw makeError('One or more vehicles not found or do not belong to this org', 'VEHICLE_NOT_FOUND', 404)
  }

  // 3. Validate all orders belong to org
  const orders = await query<{ id: string; dest_lat: number; dest_lon: number; total_weight_kg: number; total_volume_cbm: number }>(
    'SELECT id, dest_lat, dest_lon, total_weight_kg, total_volume_cbm FROM orders WHERE id = ANY($1) AND org_id = $2 AND status = \'pending\'',
    [orderIds, orgId]
  )
  if (orders.length !== orderIds.length) {
    throw makeError('One or more orders not found, do not belong to this org, or are not pending', 'ORDER_NOT_FOUND', 404)
  }

  // 4. Build SolverInput
  const stops: Stop[] = orders.map(o => ({
    orderId: o.id,
    lat: o.dest_lat,
    lon: o.dest_lon,
    weightKg: o.total_weight_kg,
    volumeCbm: o.total_volume_cbm,
  }))

  const solverVehicles: Vehicle[] = vehicles.map(v => ({
    id: v.id,
    capacityKg: v.capacity_kg,
    capacityCbm: v.capacity_cbm,
  }))

  const input: SolverInput = {
    orgId,
    warehouseLat: warehouse.lat,
    warehouseLon: warehouse.lon,
    vehicles: solverVehicles,
    stops,
    date: new Date(date),
  }

  // 5. Enqueue job
  const jobId = await enqueue('route-optimization', { orgId, warehouseId, input })
  logger.info('Route optimization enqueued', { orgId, jobId, warehouseId, date })

  return jobId
}

export async function runOptimizationJob(
  orgId: string,
  warehouseId: string,
  input: SolverInput
): Promise<void> {
  const result = await solveVRP(input, 30_000)
  logger.info('VRP solved', { orgId, routes: result.routes.length, totalDistanceKm: result.totalDistanceKm })

  const allRoutedOrderIds: string[] = []

  for (let i = 0; i < result.routes.length; i++) {
    const route = result.routes[i]
    const routeNumber = 'ROUTE-' + Date.now() + '-' + i
    const lastStop = route.stops[route.stops.length - 1]
    const estimatedDurationMinutes = lastStop ? Math.round(lastStop.arrivalMinutes) : 0

    await query(
      `INSERT INTO routes (org_id, route_number, date, vehicle_id, origin_warehouse_id, stops, total_distance_km, estimated_duration_minutes, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'planned')`,
      [
        orgId,
        routeNumber,
        input.date,
        route.vehicleId,
        warehouseId,
        JSON.stringify(route.stops),
        route.totalDistanceKm,
        estimatedDurationMinutes,
      ]
    )

    const orderIds = route.stops.map(s => s.orderId)
    allRoutedOrderIds.push(...orderIds)
  }

  if (allRoutedOrderIds.length > 0) {
    await query(
      'UPDATE orders SET status = \'allocated\', updated_at = NOW() WHERE id = ANY($1) AND org_id = $2',
      [allRoutedOrderIds, orgId]
    )
  }

  logger.info('Route optimization job complete', { orgId, routesInserted: result.routes.length })
}

export async function getJobStatus(jobId: string): Promise<Job | null> {
  return getJob(jobId)
}

export async function getRoute(orgId: string, routeId: string): Promise<RouteRow | null> {
  return queryOne<RouteRow>(
    'SELECT * FROM routes WHERE id = $1 AND org_id = $2',
    [routeId, orgId]
  )
}

export async function confirmRoute(orgId: string, routeId: string, driverId: string): Promise<RouteRow> {
  // 1. Fetch route
  const route = await getRoute(orgId, routeId)
  if (!route) throw makeError('Route not found', 'ROUTE_NOT_FOUND', 404)

  // 2. Validate status is 'planned'
  if (route.status !== 'planned') {
    throw makeError('Route is already confirmed or cannot be confirmed in its current state', 'INVALID_ROUTE_STATUS', 409)
  }

  // 3. Validate driver belongs to org
  const driver = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE id = $1 AND org_id = $2',
    [driverId, orgId]
  )
  if (!driver) throw makeError('Driver not found or does not belong to this org', 'DRIVER_NOT_FOUND', 404)

  // 4. Update route
  const rows = await query<RouteRow>(
    'UPDATE routes SET status = \'confirmed\', driver_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [driverId, routeId]
  )
  return rows[0]
}

export async function reassignRoute(
  orgId: string,
  routeId: string,
  driverId: string | undefined,
  vehicleId: string | undefined
): Promise<RouteRow> {
  // 1. Fetch route
  const route = await getRoute(orgId, routeId)
  if (!route) throw makeError('Route not found', 'ROUTE_NOT_FOUND', 404)

  // 2. Validate driver belongs to org (if provided)
  if (driverId) {
    const driver = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE id = $1 AND org_id = $2',
      [driverId, orgId]
    )
    if (!driver) throw makeError('Driver not found or does not belong to this org', 'DRIVER_NOT_FOUND', 404)
  }

  // 3. Validate vehicle belongs to org (if provided)
  if (vehicleId) {
    const vehicle = await queryOne<{ id: string }>(
      'SELECT id FROM vehicles WHERE id = $1 AND org_id = $2',
      [vehicleId, orgId]
    )
    if (!vehicle) throw makeError('Vehicle not found or does not belong to this org', 'VEHICLE_NOT_FOUND', 404)
  }

  // 4. Update route — only set fields that were provided
  const rows = await query<RouteRow>(
    'UPDATE routes SET driver_id = COALESCE($1, driver_id), vehicle_id = COALESCE($2, vehicle_id), updated_at = NOW() WHERE id = $3 RETURNING *',
    [driverId ?? null, vehicleId ?? null, routeId]
  )
  return rows[0]
}

export async function completeRoute(
  orgId: string,
  routeId: string,
  req: CompleteRouteRequest
): Promise<RouteRow> {
  const { startedAt, stopActualArrivalMinutes } = req

  // 1. Fetch and validate route
  const route = await getRoute(orgId, routeId)
  if (!route) throw makeError('Route not found', 'ROUTE_NOT_FOUND', 404)
  if (route.status !== 'confirmed') {
    throw makeError('Route must be confirmed before it can be completed', 'INVALID_ROUTE_STATUS', 409)
  }

  // 2. Parse stops JSONB
  const stops = route.stops as RouteStop[]
  if (stopActualArrivalMinutes.length !== stops.length) {
    throw makeError(
      `stopActualArrivalMinutes must have ${stops.length} entries, one per stop`,
      'VALIDATION_ERROR',
      400
    )
  }

  // 3. Feed each leg's actual speed into the speed profile
  const startedAtDate = new Date(startedAt)
  const dayOfWeek = startedAtDate.getDay()  // 0=Sunday … 6=Saturday

  for (let i = 0; i < stops.length; i++) {
    const distanceKm = stops[i].distanceFromPrevKm
    const departureMinutes = i === 0 ? 0 : stopActualArrivalMinutes[i - 1]
    const legTravelMinutes = stopActualArrivalMinutes[i] - departureMinutes

    // Skip degenerate legs (co-located stops or bad data)
    if (distanceKm <= 0 || legTravelMinutes <= 0) continue

    const departureTime = new Date(startedAtDate.getTime() + departureMinutes * 60_000)
    const hourOfDay = departureTime.getHours()
    const observedSpeedKmh = (distanceKm / legTravelMinutes) * 60

    await updateSpeedProfile(orgId, hourOfDay, dayOfWeek, observedSpeedKmh)
  }

  // 4. Mark route completed
  const actualDurationMinutes = Math.round(stopActualArrivalMinutes[stopActualArrivalMinutes.length - 1])
  const rows = await query<RouteRow>(
    `UPDATE routes
     SET status = 'completed',
         started_at = $1,
         completed_at = NOW(),
         actual_duration_minutes = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [startedAt, actualDurationMinutes, routeId]
  )

  logger.info('Route completed, speed profiles updated', { orgId, routeId, stops: stops.length })
  return rows[0]
}
