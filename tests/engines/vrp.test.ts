import { describe, it, expect } from '../runner'
import { solveVRP } from '../../engines/route-optimizer/vrp'
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

describe('vrp-solver', () => {
  it('solveVRP — result is no worse than greedy for simple 3-stop case', async () => {
    const stops = [
      makeStop('o1', 1, 0),
      makeStop('o2', 0, 1),
      makeStop('o3', 1, 1),
    ]
    const vehicles = [makeVehicle('v1', 1000, 100)]
    const input = makeInput(stops, vehicles)
    const result = await solveVRP(input, 5_000)
    const greedyResult = greedyInit(input)
    expect(result.totalDistanceKm <= greedyResult.totalDistanceKm + 0.001).toBe(true)
  })

  it('solveVRP — all stops assigned when vehicle has sufficient capacity', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 2, 0), makeStop('o3', 3, 0)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    const assignedIds = result.routes.flatMap(r => r.stops.map(s => s.orderId))
    expect(assignedIds.sort()).toEqual(['o1', 'o2', 'o3'])
  })

  it('solveVRP — 50 stops completes within 5 seconds', async () => {
    const stops: Stop[] = Array.from({ length: 50 }, (_, i) => ({
      orderId: `o${i}`,
      lat: (i % 10) * 0.1,
      lon: Math.floor(i / 10) * 0.1,
      weightKg: 10,
      volumeCbm: 0.1,
    }))
    const vehicles = [
      makeVehicle('v1', 10000, 1000),
      makeVehicle('v2', 10000, 1000),
    ]
    const result = await solveVRP(makeInput(stops, vehicles), 5_000)
    // solveTimeMs is now inside the solver metadata
    expect(result.solver.solveTimeMs < 5500).toBe(true)
    expect(result.routes.length > 0).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Phase 3.1: SolverMetadata tests
  // -------------------------------------------------------------------------

  it('solveVRP — result has solver field', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    expect(result.solver !== null && typeof result.solver === 'object').toBe(true)
  })

  it('solveVRP — solver.solverUsed is one of the three valid values', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    const valid = ['exact-bnb', 'greedy-approximation', 'hybrid']
    expect(valid.includes(result.solver.solverUsed)).toBe(true)
  })

  it('solveVRP — solver.optimalityGap is in [0, 1]', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    expect(result.solver.optimalityGap >= 0).toBe(true)
    expect(result.solver.optimalityGap <= 1).toBe(true)
  })

  it('solveVRP — solver.gapCertificate is a non-empty string', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    expect(typeof result.solver.gapCertificate).toBe('string')
    expect(result.solver.gapCertificate.length > 0).toBe(true)
  })

  it('solveVRP — solver.solveTimeMs is >= 0', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    expect(result.solver.solveTimeMs >= 0).toBe(true)
  })

  it('solveVRP — solver.nodesExplored is >= 0', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    expect(result.solver.nodesExplored >= 0).toBe(true)
  })

  it('solveVRP — fixed seed is preserved in result', async () => {
    const stops = [makeStop('o1', 1, 0), makeStop('o2', 0, 1)]
    const input = makeInput(stops, [makeVehicle('v1', 1000, 100)])
    const fixedSeed = 42
    const result = await solveVRP(input, 5_000, fixedSeed)
    expect(result.solver.seed).toBe(fixedSeed)
  })

  it('solveVRP — small n (≤ 8 stops) uses exact-bnb', async () => {
    // Use 3 stops — well within the BNB_EXACT_THRESHOLD of 8
    const stops = [
      makeStop('o1', 1, 0),
      makeStop('o2', 0, 1),
      makeStop('o3', 1, 1),
    ]
    const result = await solveVRP(makeInput(stops, [makeVehicle('v1', 1000, 100)]), 5_000)
    expect(result.solver.solverUsed).toBe('exact-bnb')
    expect(result.solver.optimalityGap).toBe(0)
  })
})
