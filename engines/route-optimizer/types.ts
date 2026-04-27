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
}

export interface SolverResult {
  routes: SolverRoute[]
  totalDistanceKm: number
  solveTimeMs: number
}
