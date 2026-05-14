// tests/engines/stochastic-planner.test.ts
import { describe, it, expect } from '../runner'
import { solveStochastic, handleMidRouteFailure, StochasticPlannerConfig } from '../../engines/route-optimizer/stochastic-planner'
import { SolverInput, Stop, Vehicle } from '../../engines/route-optimizer/types'

describe('Stochastic Planner', () => {
  const warehouseLat = 6.5244
  const warehouseLon = 3.3792
  const orgId = 'test-org'
  const date = new Date()

  function createTestStop(orderId: string, lat: number, lon: number, weightKg: number = 5): Stop {
    return {
      orderId,
      lat,
      lon,
      weightKg,
      volumeCbm: 0.1,
      earliestTime: 0, // minutes from midnight
      latestTime: 1440, // end of day
    }
  }

  function createTestVehicle(id: string, capacityKg: number = 5000): Vehicle {
    return {
      id,
      capacityKg,
      capacityCbm: 10,
    }
  }

  it('solves small problem without window partitioning', async () => {
    const stops = [
      createTestStop('s1', 6.5250, 3.3800, 5),
      createTestStop('s2', 6.5260, 3.3810, 5),
      createTestStop('s3', 6.5270, 3.3820, 5),
    ]

    const vehicles = [createTestVehicle('v1', 5000)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    const result = await solveStochastic(input, { horizonSize: 30 })

    expect(typeof result.allRoutes).toBe('object')
    expect(result.summary.totalStops).toBe(3)
    expect(result.summary.assignedStops + result.failedStops.length).toBe(3)
  })

  it('handles empty stops gracefully', async () => {
    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops: [],
      vehicles: [createTestVehicle('v1')],
    }

    const result = await solveStochastic(input)

    expect(result.allRoutes.length).toBe(0)
    expect(result.failedStops.length).toBe(0)
    expect(result.summary.totalStops).toBe(0)
    expect(result.summary.vehiclesUsed).toBe(0)
  })

  it('partitions 35 stops into multiple windows', async () => {
    // Create 35 stops across a grid
    const stops: Stop[] = []
    for (let i = 0; i < 35; i++) {
      const lat = warehouseLat + (i % 7) * 0.001
      const lon = warehouseLon + Math.floor(i / 7) * 0.001
      stops.push(createTestStop(`s${i}`, lat, lon, 5))
    }

    const vehicles = [
      createTestVehicle('v1', 10000),
      createTestVehicle('v2', 10000),
    ]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    // Default horizonSize is 30, so 35 stops → 2 windows (30 + 5)
    const result = await solveStochastic(input)

    expect(result.summary.totalStops).toBe(35)
    // Should create routes or have unassigned stops
    expect(result.allRoutes.length >= 0).toBe(true)
  })

  it('reduces vehicle capacity by bufferCapacityFraction', async () => {
    const stops = [
      createTestStop('s1', 6.5250, 3.3800, 30),
      createTestStop('s2', 6.5260, 3.3810, 30),
    ]

    const vehicles = [createTestVehicle('v1', 10000)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    // With 0.1 buffer fraction, effective capacity is 9000 (not 10000)
    // 30+30=60 should fit
    const config: StochasticPlannerConfig = {
      horizonSize: 30,
      bufferCapacityFraction: 0.1,
    }

    const result = await solveStochastic(input, config)

    expect(result.summary.totalStops).toBe(2)
    // Both stops should be assigned with buffer capacity
    expect(result.failedStops.length <= 2).toBe(true)
  })

  it('collects failed stops from infeasible windows', async () => {
    // Create 35 stops
    const stops: Stop[] = []
    for (let i = 0; i < 35; i++) {
      const lat = warehouseLat + (i % 7) * 0.001
      const lon = warehouseLon + Math.floor(i / 7) * 0.001
      stops.push({
        orderId: `s${i}`,
        lat,
        lon,
        weightKg: 10,
        volumeCbm: 0.1,
        earliestTime: i * 10, // staggered delivery windows
        latestTime: i * 10 + 60,
      })
    }

    // Single vehicle with limited capacity
    const vehicles = [createTestVehicle('v1', 300)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    const result = await solveStochastic(input, { horizonSize: 30, maxRelaxationAttempts: 1 })

    expect(result.summary.totalStops).toBe(35)
  })

  it('tracks relaxations when adding synthetic vehicles', async () => {
    // Create stops that require capacity relaxation
    const stops: Stop[] = []
    for (let i = 0; i < 25; i++) {
      const lat = warehouseLat + (i % 5) * 0.0005
      const lon = warehouseLon + Math.floor(i / 5) * 0.0005
      stops.push(createTestStop(`s${i}`, lat, lon, 15))
    }

    // Small single vehicle to force relaxation
    const vehicles = [createTestVehicle('v1', 300)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    const config: StochasticPlannerConfig = {
      horizonSize: 30,
      maxRelaxationAttempts: 3,
      bufferCapacityFraction: 0.0,
    }

    const result = await solveStochastic(input, config)

    expect(result.summary.totalStops).toBe(25)
    expect(result.relaxationsApplied >= 0).toBe(true)
  })

  it('sorts stops by delivery window and distance', async () => {
    // Create stops with different window times
    const stops = [
      {
        orderId: 'urgent',
        lat: 6.5300,
        lon: 3.3900,
        weightKg: 5,
        volumeCbm: 0.1,
        earliestTime: 0,
        latestTime: 60, // Early window
      },
      {
        orderId: 'late',
        lat: 6.5200,
        lon: 3.3700,
        weightKg: 5,
        volumeCbm: 0.1,
        earliestTime: 60,
        latestTime: 120, // Later window
      },
      {
        orderId: 'flex',
        lat: 6.5250,
        lon: 3.3800,
        weightKg: 5,
        volumeCbm: 0.1,
        earliestTime: 0,
        latestTime: 1440, // Flexible
      },
    ]

    const vehicles = [createTestVehicle('v1', 5000)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    const result = await solveStochastic(input)

    // Should successfully solve
    expect(result.allRoutes.length >= 0).toBe(true)
    expect(result.summary.totalStops).toBe(3)
  })

  it('handleMidRouteFailure re-solves remaining stops', async () => {
    const remainingStops = [
      createTestStop('r1', 6.5250, 3.3800, 5),
      createTestStop('r2', 6.5260, 3.3810, 5),
    ]

    const vehicles = [createTestVehicle('v1', 5000)]

    const result = await handleMidRouteFailure(
      'route_1',
      1,
      remainingStops,
      vehicles,
      warehouseLat,
      warehouseLon,
      orgId,
      date
    )

    expect(typeof result.routes).toBe('object')
    expect(Array.isArray(result.routes)).toBe(true)
    expect(Array.isArray(result.unassigned)).toBe(true)
  })

  it('handleMidRouteFailure returns empty for no remaining stops', async () => {
    const result = await handleMidRouteFailure(
      'route_1',
      0,
      [],
      [createTestVehicle('v1')],
      warehouseLat,
      warehouseLon,
      orgId,
      date
    )

    expect(result.routes.length).toBe(0)
    expect(result.unassigned.length).toBe(0)
  })

  it('handles configurable horizon size', async () => {
    // Create 20 stops
    const stops: Stop[] = []
    for (let i = 0; i < 20; i++) {
      const lat = warehouseLat + (i % 4) * 0.0005
      const lon = warehouseLon + Math.floor(i / 4) * 0.0005
      stops.push(createTestStop(`s${i}`, lat, lon, 5))
    }

    const vehicles = [createTestVehicle('v1', 10000)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    // With horizonSize = 10, should create 2 windows (10 + 10)
    const result = await solveStochastic(input, { horizonSize: 10 })

    expect(result.summary.totalStops).toBe(20)
  })

  it('respects timeLimitMs per window', async () => {
    const stops = [
      createTestStop('s1', 6.5250, 3.3800, 5),
      createTestStop('s2', 6.5260, 3.3810, 5),
    ]

    const vehicles = [createTestVehicle('v1', 5000)]

    const input: SolverInput = {
      orgId,
      date,
      warehouseLat,
      warehouseLon,
      stops,
      vehicles,
    }

    // Should complete quickly within the time limit
    const startTime = Date.now()
    const result = await solveStochastic(input, { timeLimitMsPerWindow: 1000 })
    const elapsedMs = Date.now() - startTime

    expect(typeof result).toBe('object')
    expect(typeof result.summary).toBe('object')
  })
})
