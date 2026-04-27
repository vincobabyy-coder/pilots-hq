import { describe, it, expect } from '../runner'
import { greedyInit } from '../../engines/route-optimizer/greedy-init'
import { Stop, Vehicle, SolverInput } from '../../engines/route-optimizer/types'

function makeStop(id: string, lat: number, lon: number, kg = 10, cbm = 0.1): Stop {
  return { orderId: id, lat, lon, weightKg: kg, volumeCbm: cbm }
}

function makeVehicle(id: string, kg = 1000, cbm = 10): Vehicle {
  return { id, capacityKg: kg, capacityCbm: cbm }
}

function makeInput(stops: Stop[], vehicles: Vehicle[]): SolverInput {
  return { orgId: 'test-org', warehouseLat: 0, warehouseLon: 0, vehicles, stops, date: new Date() }
}

describe('greedy-init', () => {
  it('greedyInit — empty stops returns empty routes', () => {
    const result = greedyInit(makeInput([], [makeVehicle('v1')]))
    expect(result.routes.length).toBe(0)
    expect(result.totalDistanceKm).toBe(0)
  })

  it('greedyInit — single stop assigned to single vehicle', () => {
    const result = greedyInit(makeInput([makeStop('o1', 1, 1)], [makeVehicle('v1')]))
    expect(result.routes.length).toBe(1)
    expect(result.routes[0].stops.length).toBe(1)
    expect(result.routes[0].stops[0].orderId).toBe('o1')
  })

  it('greedyInit — stop exceeding vehicle kg capacity not assigned', () => {
    const heavyStop = makeStop('o1', 1, 1, 999, 0.1)  // 999 kg
    const tinyVehicle = makeVehicle('v1', 100, 10)      // 100 kg capacity
    const result = greedyInit(makeInput([heavyStop], [tinyVehicle]))
    expect(result.routes.length).toBe(0)  // no routes — nothing could be assigned
  })

  it('greedyInit — with two stops, nearest to warehouse is assigned first', () => {
    const nearStop = makeStop('near', 0.1, 0, 10, 0.1)   // close to warehouse (0,0)
    const farStop  = makeStop('far',  5.0, 0, 10, 0.1)   // far from warehouse
    const result = greedyInit(makeInput([farStop, nearStop], [makeVehicle('v1')]))
    expect(result.routes.length).toBe(1)
    expect(result.routes[0].stops[0].orderId).toBe('near')
  })

  it('greedyInit — solveTimeMs is non-negative', () => {
    const result = greedyInit(makeInput([makeStop('o1', 1, 1)], [makeVehicle('v1')]))
    expect(result.solveTimeMs >= 0).toBe(true)
  })
})
