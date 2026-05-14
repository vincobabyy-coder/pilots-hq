// engines/route-optimizer/types.ts

export interface Stop {
  orderId: string
  lat: number
  lon: number
  weightKg: number
  volumeCbm: number
  earliestTime?: number   // minutes from midnight (optional time window)
  latestTime?: number     // minutes from midnight (optional time window)
}

export interface Vehicle {
  id: string
  capacityKg: number
  capacityCbm: number
}

export interface RouteStop {
  orderId: string
  lat: number
  lon: number
  arrivalMinutes: number    // estimated minutes from route start
  distanceFromPrevKm: number
}

export interface SolverRoute {
  vehicleId: string
  stops: RouteStop[]
  totalDistanceKm: number
  totalWeightKg: number
  totalVolumeCbm: number
}

export interface SolverInput {
  orgId: string
  warehouseLat: number
  warehouseLon: number
  vehicles: Vehicle[]
  stops: Stop[]
  date: Date    // used to derive dayOfWeek for speed profiles
  /** Reserve this fraction of each vehicle's capacity as a buffer (0–1). Default 0. */
  bufferCapacityFraction?: number
}

export interface SolverResult {
  routes: SolverRoute[]
  totalDistanceKm: number
  solveTimeMs: number
  /** B&B nodes explored; 0 for greedy-only runs. Internal use by vrp.ts. */
  nodesExplored?: number
}
