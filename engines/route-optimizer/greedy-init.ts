// engines/route-optimizer/greedy-init.ts
//
// Nearest-neighbor greedy heuristic that produces the initial upper-bound
// solution consumed by the branch-and-bound solver.
//
// Algorithm:
//   1. All vehicles start at the warehouse position.
//   2. Each iteration: for every (vehicle, unserved stop) pair that fits within
//      the vehicle's remaining capacity, compute the haversine distance from
//      the vehicle's current tail to that stop.
//   3. Assign the globally cheapest (vehicle, stop) pair.
//   4. Repeat until no vehicle can accept any remaining stop.

import { SolverInput, SolverResult, SolverRoute, RouteStop } from './types'
import { haversineKm } from './distance-matrix'

// Simple speed assumption for the greedy pass (km/h).
// Speed profiles are applied by the B&B solver, not here.
const GREEDY_SPEED_KMH = 40

export function greedyInit(input: SolverInput): SolverResult {
  const startTime = Date.now()

  // Early-exit: nothing to do
  if (input.vehicles.length === 0 || input.stops.length === 0) {
    return { routes: [], totalDistanceKm: 0, solveTimeMs: Date.now() - startTime }
  }

  // --- Per-vehicle mutable state ---
  interface VehicleState {
    vehicleId: string
    currentLat: number
    currentLon: number
    remainingKg: number
    remainingCbm: number
    cumulativeMinutes: number
    stops: RouteStop[]
    totalDistanceKm: number
    totalWeightKg: number
    totalVolumeCbm: number
  }

  const buffer = Math.min(Math.max(input.bufferCapacityFraction ?? 0, 0), 1)

  const vehicleStates: VehicleState[] = input.vehicles.map((v) => ({
    vehicleId: v.id,
    currentLat: input.warehouseLat,
    currentLon: input.warehouseLon,
    remainingKg: v.capacityKg * (1 - buffer),
    remainingCbm: v.capacityCbm * (1 - buffer),
    cumulativeMinutes: 0,
    stops: [],
    totalDistanceKm: 0,
    totalWeightKg: 0,
    totalVolumeCbm: 0,
  }))

  // Use a Set of indices into input.stops for O(1) deletion
  const unserved = new Set<number>(input.stops.map((_, i) => i))

  // --- Main loop ---
  while (unserved.size > 0) {
    let bestCost = Infinity
    let bestVehicleIdx = -1
    let bestStopIdx = -1
    let bestDist = 0

    // Find the cheapest (vehicle, stop) pair
    for (let vi = 0; vi < vehicleStates.length; vi++) {
      const vs = vehicleStates[vi]

      for (const si of unserved) {
        const stop = input.stops[si]

        // Capacity check — both dimensions must fit
        if (stop.weightKg > vs.remainingKg || stop.volumeCbm > vs.remainingCbm) {
          continue
        }

        const dist = haversineKm(vs.currentLat, vs.currentLon, stop.lat, stop.lon)
        if (dist < bestCost) {
          bestCost = dist
          bestVehicleIdx = vi
          bestStopIdx = si
          bestDist = dist
        }
      }
    }

    // No vehicle can absorb any remaining stop — return partial assignment
    if (bestVehicleIdx === -1) break

    // Commit the assignment
    const vs = vehicleStates[bestVehicleIdx]
    const stop = input.stops[bestStopIdx]

    // Travel time for this leg (minutes)
    const legMinutes = (bestDist / GREEDY_SPEED_KMH) * 60

    vs.cumulativeMinutes += legMinutes

    const routeStop: RouteStop = {
      orderId: stop.orderId,
      lat: stop.lat,
      lon: stop.lon,
      arrivalMinutes: vs.cumulativeMinutes,
      distanceFromPrevKm: bestDist,
    }

    vs.stops.push(routeStop)
    vs.totalDistanceKm += bestDist
    vs.totalWeightKg += stop.weightKg
    vs.totalVolumeCbm += stop.volumeCbm
    vs.remainingKg -= stop.weightKg
    vs.remainingCbm -= stop.volumeCbm
    vs.currentLat = stop.lat
    vs.currentLon = stop.lon

    unserved.delete(bestStopIdx)
  }

  // Build output — only include vehicles that received at least one stop
  const routes: SolverRoute[] = vehicleStates
    .filter((vs) => vs.stops.length > 0)
    .map((vs) => ({
      vehicleId: vs.vehicleId,
      stops: vs.stops,
      totalDistanceKm: vs.totalDistanceKm,
      totalWeightKg: vs.totalWeightKg,
      totalVolumeCbm: vs.totalVolumeCbm,
    }))

  const totalDistanceKm = routes.reduce((sum, r) => sum + r.totalDistanceKm, 0)

  return {
    routes,
    totalDistanceKm,
    solveTimeMs: Date.now() - startTime,
  }
}
