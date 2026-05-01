import { describe, it, expect } from '../runner'
import { explainAllocation, whatIfExclude } from '../../engines/allocation/decision'
import { AllocationOrder, AllocationWarehouse, buildCostMatrix } from '../../engines/allocation/bipartite-graph'
import { hungarian } from '../../engines/allocation/hungarian'

// Simple test data — no DB required
const order: AllocationOrder = { id: 'O1', lat: 0, lon: 0, weightKg: 10, volumeCbm: 0.5 }
const warehouses: AllocationWarehouse[] = [
  { id: 'W1', lat: 0.1, lon: 0.1, capacityUnits: 100, currentUnits: 50, inventory: new Map() },
  { id: 'W2', lat: 1.0, lon: 1.0, capacityUnits: 100, currentUnits: 10, inventory: new Map() },
]

function runAndExplain(o: AllocationOrder, whs: AllocationWarehouse[]) {
  const costMatrix = buildCostMatrix([o], whs)
  const assignment = hungarian(costMatrix)
  const whIndex = assignment[0]
  return { decision: explainAllocation(o, whs, whIndex, costMatrix), whIndex }
}

describe('explainAllocation', () => {
  it('returns an object with assignedWarehouseId, factors, and alternatives', () => {
    const { decision } = runAndExplain(order, warehouses)
    expect(typeof decision.assignedWarehouseId).toBe('string')
    expect(Array.isArray(decision.factors)).toBe(true)
    expect(Array.isArray(decision.alternatives)).toBe(true)
  })

  it('alternatives has length warehouses.length - 1', () => {
    const { decision } = runAndExplain(order, warehouses)
    expect(decision.alternatives).toHaveLength(warehouses.length - 1)
  })

  it('alternatives[0].costGap >= 0 (runner-up costs at least as much as winner)', () => {
    const { decision } = runAndExplain(order, warehouses)
    // costGap must be non-negative — runner-up is never cheaper
    expect(decision.alternatives[0].costGap >= 0).toBe(true)
  })

  it('factors is a non-empty array', () => {
    const { decision } = runAndExplain(order, warehouses)
    expect(decision.factors.length > 0).toBe(true)
  })

  it('explanation is a non-empty string', () => {
    const { decision } = runAndExplain(order, warehouses)
    expect(typeof decision.explanation).toBe('string')
    expect(decision.explanation.length > 0).toBe(true)
  })

  it('factors weights sum to approximately 1.0 (within 0.01), handles zero-cost edge case', () => {
    const { decision } = runAndExplain(order, warehouses)
    const totalWeight = decision.factors.reduce((sum, f) => sum + f.weight, 0)
    // When total cost is 0 all weights will be 0; otherwise they should sum to ~1.0
    const isZeroCost = decision.assignedCost === 0
    if (!isZeroCost) {
      expect(Math.abs(totalWeight - 1.0) <= 0.01).toBe(true)
    } else {
      // Edge case: zero total cost — weights are all 0 which is valid
      expect(totalWeight >= 0).toBe(true)
    }
  })
})

describe('whatIfExclude', () => {
  it('excluding the assigned warehouse returns a different warehouse', () => {
    const { decision: original } = runAndExplain(order, warehouses)
    const assignedId = original.assignedWarehouseId

    const result = whatIfExclude(order, warehouses, [assignedId])
    expect(result.assignedWarehouseId !== null).toBe(true)
    expect(result.assignedWarehouseId !== assignedId).toBe(true)
    expect(result.decision !== null).toBe(true)
  })

  it('excluding ALL warehouses returns { assignedWarehouseId: null, decision: null }', () => {
    const allIds = warehouses.map(w => w.id)
    const result = whatIfExclude(order, warehouses, allIds)
    expect(result.assignedWarehouseId).toBeNull()
    expect(result.decision).toBeNull()
  })
})
