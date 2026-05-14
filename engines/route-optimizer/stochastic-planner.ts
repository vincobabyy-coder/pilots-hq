import { solveVRP } from './vrp'
import { haversineKm } from './distance-matrix'
import { Vehicle, Stop, SolverInput, SolverRoute } from './types'
import { logger } from '../../core/logger/logger'

/**
 * STOCHASTIC PLANNER — Rolling Horizon Solver
 *
 * For large-scale routing (100+ stops):
 * - Partitions stops into configurable windows (default 30 stops)
 * - Solves each window independently with VRP solver
 * - On infeasibility: adds synthetic vehicles and retries
 * - Collects unassigned stops and returns with relaxation stats
 *
 * Key insight: By solving windows independently, we can handle
 * much larger problem sizes than VRP alone, at the cost of
 * global optimality (acceptable for logistics where windows
 * are natural anyway).
 */

export interface StochasticResult {
  allRoutes: SolverRoute[]
  failedStops: Stop[]
  relaxationsApplied: number
  summary: {
    totalStops: number
    assignedStops: number
    failedStops: number
    vehiclesUsed: number
  }
}

export interface StochasticPlannerConfig {
  horizonSize?: number // stops per window; default 30
  bufferCapacityFraction?: number // reduce vehicle capacity by this fraction; default 0.1
  maxRelaxationAttempts?: number // max retries with synthetic vehicles; default 3
  timeLimitMsPerWindow?: number // max ms per VRP solve; default 10_000
}

/**
 * Sort stops by delivery window start time, then distance from warehouse.
 * This clustering heuristic groups geographically and temporally close stops.
 */
function sortStopsForClustering(
  stops: Stop[],
  warehouseLat: number,
  warehouseLon: number
): Stop[] {
  const withDist = stops.map(stop => ({
    stop,
    windowStart: stop.earliestTime ?? 0,
    distance: haversineKm(warehouseLat, warehouseLon, stop.lat, stop.lon),
  }))

  // Sort by window start, then by distance from warehouse
  withDist.sort((a, b) => {
    if (a.windowStart !== b.windowStart) {
      return a.windowStart - b.windowStart
    }
    return a.distance - b.distance
  })

  return withDist.map(x => x.stop)
}

/**
 * Solve a single horizon window with capacity reduction.
 * If infeasible, retry with synthetic vehicles.
 */
async function solveWindow(
  windowStops: Stop[],
  vehicles: Vehicle[],
  warehouseLat: number,
  warehouseLon: number,
  bufferCapacityFraction: number,
  maxRelaxationAttempts: number,
  timeLimitMsPerWindow: number,
  orgId: string,
  date: Date
): Promise<{ routes: SolverRoute[]; unassigned: Stop[]; relaxationsUsed: number }> {
  // Reduce vehicle capacity by buffer fraction
  const reducedVehicles = vehicles.map(v => ({
    ...v,
    capacityKg: Math.floor(v.capacityKg * (1 - bufferCapacityFraction)),
    capacityCbm: v.capacityCbm * (1 - bufferCapacityFraction),
  }))

  let currentVehicles = reducedVehicles
  let relaxationsUsed = 0

  for (let attempt = 0; attempt <= maxRelaxationAttempts; attempt++) {
    try {
      const input: SolverInput = {
        orgId,
        date,
        warehouseLat,
        warehouseLon,
        stops: windowStops,
        vehicles: currentVehicles,
        bufferCapacityFraction,
      }

      const result = await solveVRP(input)

      // Identify which stops were assigned
      const assignedOrderIds = new Set<string>()
      for (const route of result.routes) {
        for (const routeStop of route.stops) {
          assignedOrderIds.add(routeStop.orderId)
        }
      }

      // Find unassigned stops
      const unassignedStops = windowStops.filter(s => !assignedOrderIds.has(s.orderId))

      if (unassignedStops.length === 0) {
        // Feasible solution found
        return { routes: result.routes, unassigned: [], relaxationsUsed }
      }

      if (attempt < maxRelaxationAttempts) {
        // Infeasible; add synthetic vehicle and retry
        const syntheticVehicle: Vehicle = {
          id: `synthetic_${attempt}`,
          capacityKg: 5000, // 5000 kg capacity
          capacityCbm: 10, // 10 cbm capacity
        }
        currentVehicles = [...currentVehicles, syntheticVehicle]
        relaxationsUsed++
      } else {
        // Max attempts reached; return unassigned
        return {
          routes: result.routes,
          unassigned: unassignedStops,
          relaxationsUsed,
        }
      }
    } catch (err) {
      logger.error('Window solve error', {
        attempt,
        stopsInWindow: windowStops.length,
        error: (err as Error).message,
      })
      return { routes: [], unassigned: windowStops, relaxationsUsed }
    }
  }

  // Should not reach here, but return unassigned if we do
  return { routes: [], unassigned: windowStops, relaxationsUsed }
}

/**
 * Solve a large routing problem using rolling horizon approach.
 * Partitions stops into windows, solves each independently, collects results.
 */
export async function solveStochastic(
  input: SolverInput,
  config: StochasticPlannerConfig = {}
): Promise<StochasticResult> {
  const horizonSize = config.horizonSize ?? 30
  const bufferCapacityFraction = config.bufferCapacityFraction ?? 0.1
  const maxRelaxationAttempts = config.maxRelaxationAttempts ?? 3
  const timeLimitMsPerWindow = config.timeLimitMsPerWindow ?? 10_000

  if (input.stops.length === 0) {
    return {
      allRoutes: [],
      failedStops: [],
      relaxationsApplied: 0,
      summary: { totalStops: 0, assignedStops: 0, failedStops: 0, vehiclesUsed: 0 },
    }
  }

  // Sort stops for clustering
  const sortedStops = sortStopsForClustering(
    input.stops,
    input.warehouseLat,
    input.warehouseLon
  )

  // Partition into windows
  const windows: Stop[][] = []
  for (let i = 0; i < sortedStops.length; i += horizonSize) {
    windows.push(sortedStops.slice(i, i + horizonSize))
  }

  logger.info('Stochastic planning starting', {
    totalStops: sortedStops.length,
    windowCount: windows.length,
    horizonSize,
  })

  // Solve each window
  const allRoutes: SolverRoute[] = []
  const failedStops: Stop[] = []
  let totalRelaxations = 0

  for (let windowIdx = 0; windowIdx < windows.length; windowIdx++) {
    const windowStops = windows[windowIdx]

    const { routes, unassigned, relaxationsUsed } = await solveWindow(
      windowStops,
      input.vehicles,
      input.warehouseLat,
      input.warehouseLon,
      bufferCapacityFraction,
      maxRelaxationAttempts,
      timeLimitMsPerWindow,
      input.orgId,
      input.date
    )

    allRoutes.push(...routes)
    failedStops.push(...unassigned)
    totalRelaxations += relaxationsUsed

    logger.info('Window solved', {
      windowIdx,
      stopsInWindow: windowStops.length,
      routesGenerated: routes.length,
      unassignedCount: unassigned.length,
      relaxationsUsed,
    })
  }

  const assignedCount = sortedStops.length - failedStops.length
  const vehicleIds = new Set(allRoutes.map(r => r.vehicleId))

  return {
    allRoutes,
    failedStops,
    relaxationsApplied: totalRelaxations,
    summary: {
      totalStops: sortedStops.length,
      assignedStops: assignedCount,
      failedStops: failedStops.length,
      vehiclesUsed: vehicleIds.size,
    },
  }
}

/**
 * Re-solve remaining stops from driver's current location.
 * Called mid-route when a stop is marked failed (customer not available, etc.)
 * Budget: 5 seconds for fast re-optimization.
 */
export async function handleMidRouteFailure(
  routeId: string,
  failedStopIndex: number,
  remainingStops: Stop[],
  vehicles: Vehicle[],
  warehouseLat: number,
  warehouseLon: number,
  orgId: string,
  date: Date
): Promise<{ routes: SolverRoute[]; unassigned: Stop[] }> {
  logger.info('Mid-route failure handling', {
    routeId,
    failedStopIndex,
    remainingStopsCount: remainingStops.length,
  })

  if (remainingStops.length === 0) {
    return { routes: [], unassigned: [] }
  }

  try {
    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops: remainingStops,
      vehicles,
    }

    const result = await solveVRP(input)

    // Identify which stops were assigned
    const assignedOrderIds = new Set<string>()
    for (const route of result.routes) {
      for (const routeStop of route.stops) {
        assignedOrderIds.add(routeStop.orderId)
      }
    }

    // Find unassigned stops
    const unassignedStops = remainingStops.filter(s => !assignedOrderIds.has(s.orderId))

    return { routes: result.routes, unassigned: unassignedStops }
  } catch (err) {
    logger.error('Mid-route failure handling error', {
      routeId,
      error: (err as Error).message,
    })
    return { routes: [], unassigned: remainingStops }
  }
}
