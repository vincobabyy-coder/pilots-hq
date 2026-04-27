// engines/route-optimizer/branch-and-bound.ts
//
// Branch-and-bound improvement pass on top of a greedy initial solution.
//
// Strategy:
//   - DFS via an explicit stack (no recursion — avoids stack overflow on large inputs).
//   - Prune any node whose lowerBound >= current best cost.
//   - Lower bound: sum of each unserved stop's minimum haversine distance to
//     any route tail (or the warehouse if no routes exist yet).
//   - Branch on the FIRST unserved stop only (fixed order), trying every
//     feasible insertion position in every existing route, then optionally
//     opening a new route.
//   - Time-windows (earliestTime / latestTime) are intentionally ignored in
//     Week 2 — distance is the only optimisation objective.

import { SolverInput, SolverResult, SolverRoute, RouteStop, Stop } from './types'
import { haversineKm } from './distance-matrix'

const BNB_SPEED_KMH = 40

// ---------------------------------------------------------------------------
// Internal state carried in the DFS stack
// ---------------------------------------------------------------------------

interface BnBState {
  routes: SolverRoute[]          // routes built so far
  unserved: Stop[]               // stops not yet assigned
  cost: number                   // total distance committed so far
  vehicleRemainingKg: number[]   // parallel to routes[]
  vehicleRemainingCbm: number[]  // parallel to routes[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Nearest-insertion lower bound.
 * For each unserved stop, find the minimum haversine distance to ANY current
 * route's last stop (or the warehouse when no routes exist). Sum these minimums.
 * This underestimates the true remaining cost, so it is a valid lower bound.
 */
function nearestInsertionLowerBound(
  unserved: Stop[],
  routes: SolverRoute[],
  warehouseLat: number,
  warehouseLon: number
): number {
  if (unserved.length === 0) return 0

  // Collect anchor points: last stop of each route, or the warehouse
  const anchors: Array<{ lat: number; lon: number }> = routes.length > 0
    ? routes.map((r) => {
        const last = r.stops[r.stops.length - 1]
        return { lat: last.lat, lon: last.lon }
      })
    : [{ lat: warehouseLat, lon: warehouseLon }]

  let total = 0
  for (const stop of unserved) {
    let minDist = Infinity
    for (const anchor of anchors) {
      const d = haversineKm(anchor.lat, anchor.lon, stop.lat, stop.lon)
      if (d < minDist) minDist = d
    }
    total += minDist
  }
  return total
}

/**
 * Cost delta of inserting `newStop` at position `pos` (0-indexed) in `route`.
 *
 * Positions:
 *   pos === route.stops.length  →  append at end
 *   0 <= pos < route.stops.length  →  insert before stops[pos]
 *
 * Delta formula:
 *   Append:  haversine(lastStop, newStop)
 *   Insert:  haversine(prev, new) + haversine(new, next) − haversine(prev, next)
 *            where prev = stops[pos-1] or warehouse (if pos === 0)
 */
function insertionCostDelta(
  route: SolverRoute,
  pos: number,
  newStop: Stop,
  warehouseLat: number,
  warehouseLon: number
): number {
  const stops = route.stops

  if (stops.length === 0) {
    // Empty route: just the trip from warehouse to this stop
    return haversineKm(warehouseLat, warehouseLon, newStop.lat, newStop.lon)
  }

  if (pos === stops.length) {
    // Append
    const last = stops[stops.length - 1]
    return haversineKm(last.lat, last.lon, newStop.lat, newStop.lon)
  }

  // Insert between prev and next
  const prevLat = pos === 0 ? warehouseLat : stops[pos - 1].lat
  const prevLon = pos === 0 ? warehouseLon : stops[pos - 1].lon
  const nextStop = stops[pos]

  return (
    haversineKm(prevLat, prevLon, newStop.lat, newStop.lon) +
    haversineKm(newStop.lat, newStop.lon, nextStop.lat, nextStop.lon) -
    haversineKm(prevLat, prevLon, nextStop.lat, nextStop.lon)
  )
}

/**
 * Rebuild all RouteStop.arrivalMinutes after a stop is inserted.
 * Uses cumulative distance from warehouse at GREEDY_SPEED_KMH.
 */
function recomputeArrivals(
  stops: RouteStop[],
  warehouseLat: number,
  warehouseLon: number
): void {
  let cumMinutes = 0
  let prevLat = warehouseLat
  let prevLon = warehouseLon

  for (const rs of stops) {
    const dist = haversineKm(prevLat, prevLon, rs.lat, rs.lon)
    cumMinutes += (dist / BNB_SPEED_KMH) * 60
    rs.distanceFromPrevKm = dist
    rs.arrivalMinutes = cumMinutes
    prevLat = rs.lat
    prevLon = rs.lon
  }
}

/**
 * Deep-clone a BnBState so branches don't share mutable objects.
 */
function cloneState(state: BnBState): BnBState {
  return {
    routes: state.routes.map((r) => ({
      vehicleId: r.vehicleId,
      stops: r.stops.map((s) => ({ ...s })),
      totalDistanceKm: r.totalDistanceKm,
      totalWeightKg: r.totalWeightKg,
      totalVolumeCbm: r.totalVolumeCbm,
    })),
    unserved: [...state.unserved],
    cost: state.cost,
    vehicleRemainingKg: [...state.vehicleRemainingKg],
    vehicleRemainingCbm: [...state.vehicleRemainingCbm],
  }
}

/**
 * Compute the total distance of a solution (sum across all routes).
 */
function totalDistance(routes: SolverRoute[]): number {
  return routes.reduce((sum, r) => sum + r.totalDistanceKm, 0)
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function branchAndBound(
  input: SolverInput,
  initialSolution: SolverResult,
  timeLimitMs = 30_000
): SolverResult {
  const startTime = Date.now()

  let bestCost = initialSolution.totalDistanceKm
  let bestRoutes = initialSolution.routes

  // Build the initial BnB state from EMPTY routes (we let B&B reconstruct
  // from scratch so it can explore orderings the greedy pass missed).
  // All stops start unserved.
  const initialState: BnBState = {
    routes: [],
    unserved: [...input.stops],
    cost: 0,
    vehicleRemainingKg: [],
    vehicleRemainingCbm: [],
  }

  const stack: BnBState[] = [initialState]

  while (stack.length > 0) {
    // Time-limit guard
    if (Date.now() - startTime >= timeLimitMs) break

    const state = stack.pop()!

    // --- Terminal node ---
    if (state.unserved.length === 0) {
      if (state.cost < bestCost) {
        bestCost = state.cost
        bestRoutes = state.routes
      }
      continue
    }

    // --- Pruning ---
    const lb = state.cost + nearestInsertionLowerBound(
      state.unserved,
      state.routes,
      input.warehouseLat,
      input.warehouseLon
    )
    if (lb >= bestCost) continue

    // --- Branch on the first unserved stop (fixed branching order) ---
    const nextStop = state.unserved[0]
    const remainingUnserved = state.unserved.slice(1)

    // Branch A: insert nextStop at every feasible position in every existing route
    for (let ri = 0; ri < state.routes.length; ri++) {
      const route = state.routes[ri]
      const remKg = state.vehicleRemainingKg[ri]
      const remCbm = state.vehicleRemainingCbm[ri]

      // Capacity feasibility
      if (nextStop.weightKg > remKg || nextStop.volumeCbm > remCbm) continue

      // Try every insertion position: 0 … stops.length (append = stops.length)
      for (let pos = 0; pos <= route.stops.length; pos++) {
        const delta = insertionCostDelta(
          route,
          pos,
          nextStop,
          input.warehouseLat,
          input.warehouseLon
        )
        const newCost = state.cost + delta

        // Early prune before cloning
        if (newCost >= bestCost) continue

        const newState = cloneState(state)
        newState.unserved = remainingUnserved // already a fresh slice
        newState.cost = newCost

        // Insert the new RouteStop into the cloned route
        const newRouteStop: RouteStop = {
          orderId: nextStop.orderId,
          lat: nextStop.lat,
          lon: nextStop.lon,
          arrivalMinutes: 0,           // recomputed below
          distanceFromPrevKm: 0,       // recomputed below
        }
        newState.routes[ri].stops.splice(pos, 0, newRouteStop)
        newState.routes[ri].totalWeightKg += nextStop.weightKg
        newState.routes[ri].totalVolumeCbm += nextStop.volumeCbm
        newState.vehicleRemainingKg[ri] -= nextStop.weightKg
        newState.vehicleRemainingCbm[ri] -= nextStop.volumeCbm

        // Recompute arrivals and totalDistanceKm for the modified route
        recomputeArrivals(
          newState.routes[ri].stops,
          input.warehouseLat,
          input.warehouseLon
        )
        newState.routes[ri].totalDistanceKm = newState.routes[ri].stops.reduce(
          (sum, s) => sum + s.distanceFromPrevKm,
          0
        )

        stack.push(newState)
      }
    }

    // Branch B: open a new route for nextStop (if unused vehicles remain)
    const usedVehicleIds = new Set(state.routes.map((r) => r.vehicleId))
    const availableVehicle = input.vehicles.find(
      (v) =>
        !usedVehicleIds.has(v.id) &&
        nextStop.weightKg <= v.capacityKg &&
        nextStop.volumeCbm <= v.capacityCbm
    )

    if (availableVehicle) {
      const legDist = haversineKm(
        input.warehouseLat,
        input.warehouseLon,
        nextStop.lat,
        nextStop.lon
      )
      const newCost = state.cost + legDist

      if (newCost < bestCost) {
        const newState = cloneState(state)
        newState.unserved = remainingUnserved
        newState.cost = newCost

        const newRouteStop: RouteStop = {
          orderId: nextStop.orderId,
          lat: nextStop.lat,
          lon: nextStop.lon,
          arrivalMinutes: (legDist / BNB_SPEED_KMH) * 60,
          distanceFromPrevKm: legDist,
        }

        const newRoute: SolverRoute = {
          vehicleId: availableVehicle.id,
          stops: [newRouteStop],
          totalDistanceKm: legDist,
          totalWeightKg: nextStop.weightKg,
          totalVolumeCbm: nextStop.volumeCbm,
        }

        newState.routes.push(newRoute)
        newState.vehicleRemainingKg.push(availableVehicle.capacityKg - nextStop.weightKg)
        newState.vehicleRemainingCbm.push(availableVehicle.capacityCbm - nextStop.volumeCbm)

        stack.push(newState)
      }
    }
  }

  return {
    routes: bestRoutes,
    totalDistanceKm: bestCost,
    solveTimeMs: Date.now() - startTime,
  }
}
