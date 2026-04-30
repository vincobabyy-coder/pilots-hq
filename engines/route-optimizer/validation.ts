// engines/route-optimizer/validation.ts
//
// Hard constraint validation for routes before dispatch.
// Critical violations block dispatch; warnings are soft signals for operators.

export type ConstraintSeverity = 'critical' | 'warning' | 'info'

export interface ConstraintViolation {
  constraint: string        // 'vehicle_capacity' | 'time_window' | 'no_stops' | 'duplicate_stops'
  severity: ConstraintSeverity
  details: string           // human-readable explanation
  metric?: number           // the actual value that violated
  threshold?: number        // the limit that was exceeded
  suggestedFix?: string
}

export interface RouteValidationResult {
  isValid: boolean                          // false if any critical violations
  criticalViolations: ConstraintViolation[] // must fix before dispatch
  warnings: ConstraintViolation[]           // should review, not blocking
  infos: ConstraintViolation[]              // observations, not blocking
}

export interface RouteValidationInput {
  stops: Array<{ lat: number; lon: number; demandUnits?: number }>
  vehicleCapacityUnits?: number
  maxStops?: number             // default 100
  timeWindowMinutes?: number    // max total route duration, optional
}

// ---------------------------------------------------------------------------
// Individual constraint checkers
// ---------------------------------------------------------------------------

/**
 * Route requires at least 2 stops (origin + 1 destination).
 */
export function checkMinimumStops(stops: unknown[]): ConstraintViolation | null {
  if (stops.length < 2) {
    return {
      constraint: 'no_stops',
      severity: 'critical',
      details: 'Route requires at least 2 stops (origin + 1 destination)',
      metric: stops.length,
      threshold: 2,
      suggestedFix: 'Add at least one destination stop to the route.',
    }
  }
  return null
}

/**
 * Route must not exceed the maximum allowed number of stops.
 */
export function checkMaximumStops(stops: unknown[], max: number): ConstraintViolation | null {
  if (stops.length > max) {
    return {
      constraint: 'no_stops',
      severity: 'critical',
      details: `Route has ${stops.length} stops, maximum is ${max}`,
      metric: stops.length,
      threshold: max,
      suggestedFix: `Split the route so each has no more than ${max} stops.`,
    }
  }
  return null
}

/**
 * Total demand across all stops must not exceed vehicle capacity.
 */
export function checkVehicleCapacity(
  stops: Array<{ demandUnits?: number }>,
  capacityUnits: number
): ConstraintViolation | null {
  const totalDemand = stops.reduce((sum, s) => sum + (s.demandUnits ?? 0), 0)
  if (totalDemand > capacityUnits) {
    return {
      constraint: 'vehicle_capacity',
      severity: 'critical',
      details: `Total demand ${totalDemand} units exceeds vehicle capacity of ${capacityUnits} units`,
      metric: totalDemand,
      threshold: capacityUnits,
      suggestedFix: 'Reduce the number of stops or assign a higher-capacity vehicle.',
    }
  }
  return null
}

/**
 * Warn when two or more stops share identical lat/lon coordinates.
 */
export function checkDuplicateStops(
  stops: Array<{ lat: number; lon: number }>
): ConstraintViolation | null {
  const seen = new Set<string>()
  for (const stop of stops) {
    const key = `${stop.lat},${stop.lon}`
    if (seen.has(key)) {
      return {
        constraint: 'duplicate_stops',
        severity: 'warning',
        details: '2 stops share the same coordinates — possible duplicate',
        suggestedFix: 'Review the stop list and remove any accidental duplicates.',
      }
    }
    seen.add(key)
  }
  return null
}

/**
 * Warn when vehicle utilization is high (>80% but ≤100%).
 * Capacity violation is handled separately by checkVehicleCapacity.
 */
export function checkHighCapacityUtilization(
  stops: Array<{ demandUnits?: number }>,
  capacityUnits: number
): ConstraintViolation | null {
  const totalDemand = stops.reduce((sum, s) => sum + (s.demandUnits ?? 0), 0)
  const utilization = totalDemand / capacityUnits

  if (utilization > 0.8 && utilization <= 1.0) {
    const pct = Math.round(utilization * 100)
    return {
      constraint: 'vehicle_capacity',
      severity: 'warning',
      details: `Vehicle is at ${pct}% capacity — high utilization, consider splitting`,
      metric: totalDemand,
      threshold: capacityUnits,
      suggestedFix: 'Consider splitting this route across two vehicles to reduce per-vehicle load.',
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Run all constraint checks against a route input.
 * Returns a structured result separating critical violations from warnings.
 */
export function validateRouteInput(input: RouteValidationInput): RouteValidationResult {
  const { stops, vehicleCapacityUnits, maxStops = 100 } = input

  const criticalViolations: ConstraintViolation[] = []
  const warnings: ConstraintViolation[] = []
  const infos: ConstraintViolation[] = []

  // Critical checks
  const minStopsViolation = checkMinimumStops(stops)
  if (minStopsViolation) criticalViolations.push(minStopsViolation)

  const maxStopsViolation = checkMaximumStops(stops, maxStops)
  if (maxStopsViolation) criticalViolations.push(maxStopsViolation)

  if (vehicleCapacityUnits !== undefined) {
    const capacityViolation = checkVehicleCapacity(stops, vehicleCapacityUnits)
    if (capacityViolation) criticalViolations.push(capacityViolation)
  }

  // Warning checks
  const duplicateViolation = checkDuplicateStops(stops)
  if (duplicateViolation) warnings.push(duplicateViolation)

  if (vehicleCapacityUnits !== undefined) {
    const highUtilizationWarning = checkHighCapacityUtilization(stops, vehicleCapacityUnits)
    if (highUtilizationWarning) warnings.push(highUtilizationWarning)
  }

  return {
    isValid: criticalViolations.length === 0,
    criticalViolations,
    warnings,
    infos,
  }
}
