import { describe, it, expect } from '../runner'
import { hungarian, AllocationError } from '../../engines/allocation/hungarian'
import { buildCostMatrix } from '../../engines/allocation/bipartite-graph'
import { allocate } from '../../engines/allocation/hungarian'
import { AllocationOrder, AllocationWarehouse } from '../../engines/allocation/bipartite-graph'

describe('Hungarian Algorithm', () => {
  it('trivial 1x1 assignment', () => {
    const result = hungarian([[5]])
    expect(result).toEqual([0])
  })

  it('2x2 picks minimum total cost', () => {
    // cost = [[1, 3], [4, 2]] — optimal: [0]=0 (cost 1), [1]=1 (cost 2) = total 3
    const result = hungarian([[1, 3], [4, 2]])
    expect(result).toEqual([0, 1])
  })

  it('3x3 known optimal assignment', () => {
    // [[9,2,7],[3,6,4],[1,8,5]] — optimal: row0→col1(2), row1→col2(4), row2→col0(1) = 7
    const result = hungarian([[9,2,7],[3,6,4],[1,8,5]])
    // row0 gets col1, row1 gets col2, row2 gets col0
    const totalCost = [[9,2,7],[3,6,4],[1,8,5]][0][result[0]] +
                      [[9,2,7],[3,6,4],[1,8,5]][1][result[1]] +
                      [[9,2,7],[3,6,4],[1,8,5]][2][result[2]]
    expect(totalCost).toBe(7)
  })

  it('rectangular 4x3 — all assignments valid (no out-of-bounds)', () => {
    const matrix = [[1,2,3],[4,5,6],[7,8,9],[2,3,4]]
    const result = hungarian(matrix)
    expect(result).toHaveLength(4)
    // All assignments should be valid column indices (0-2) or -1 for padded rows
    result.forEach(col => {
      expect(col >= -1 && col <= 2).toBe(true)
    })
  })

  it('throws AllocationError on non-rectangular matrix', () => {
    expect(() => hungarian([[1,2],[3]])).toThrow('rectangular')
  })

  it('returns empty for empty matrix', () => {
    expect(hungarian([])).toEqual([])
  })
})

describe('Allocation end-to-end', () => {
  it('assigns orders to nearest available warehouse', () => {
    const orders: AllocationOrder[] = [
      { id: 'o1', lat: 6.5, lon: 3.3, requiredSkus: ['A'] },
    ]
    const warehouses: AllocationWarehouse[] = [
      {
        id: 'wh1', lat: 6.6, lon: 3.4,
        capacityUnits: 100, currentUnits: 20,
        inventory: new Map([['A', { quantity: 10, reservedQuantity: 0 }]])
      },
      {
        id: 'wh2', lat: 9.0, lon: 7.0,  // far away
        capacityUnits: 100, currentUnits: 20,
        inventory: new Map([['A', { quantity: 10, reservedQuantity: 0 }]])
      }
    ]
    const result = allocate(orders, warehouses)
    expect(result.get('o1')).toBe('wh1')  // nearest
  })

  it('applies inventory deficit penalty — avoids warehouse with no stock', () => {
    const orders: AllocationOrder[] = [
      { id: 'o1', lat: 6.5, lon: 3.3, requiredSkus: ['B'] },
    ]
    const warehouses: AllocationWarehouse[] = [
      {
        id: 'wh1', lat: 6.51, lon: 3.31,  // very close, but no stock for B
        capacityUnits: 100, currentUnits: 20,
        inventory: new Map()  // B not in stock
      },
      {
        id: 'wh2', lat: 6.55, lon: 3.35,  // slightly farther, but has stock
        capacityUnits: 100, currentUnits: 20,
        inventory: new Map([['B', { quantity: 50, reservedQuantity: 0 }]])
      }
    ]
    const result = allocate(orders, warehouses)
    expect(result.get('o1')).toBe('wh2')  // wh1 has +1000 penalty for missing B
  })

  it('applies capacity penalty — avoids over-utilized warehouse', () => {
    const orders: AllocationOrder[] = [
      { id: 'o1', lat: 6.5, lon: 3.3 },
    ]
    const warehouses: AllocationWarehouse[] = [
      {
        id: 'wh1', lat: 6.51, lon: 3.31,  // close but 95% full
        capacityUnits: 100, currentUnits: 95,
        inventory: new Map()
      },
      {
        id: 'wh2', lat: 6.55, lon: 3.35,  // slightly farther, 20% full
        capacityUnits: 100, currentUnits: 20,
        inventory: new Map()
      }
    ]
    const result = allocate(orders, warehouses)
    // wh1 has capacity penalty: 0.95 * 200 = 190. Distance diff is tiny, so wh2 wins.
    expect(result.get('o1')).toBe('wh2')
  })

  it('returns empty map for empty orders', () => {
    const result = allocate([], [])
    expect(result.size).toBe(0)
  })
})

describe('Cost Matrix', () => {
  it('returns empty for empty orders', () => {
    expect(buildCostMatrix([], [])).toEqual([])
  })

  it('matrix dimensions match orders x warehouses', () => {
    const orders: AllocationOrder[] = [
      { id: 'o1', lat: 6.5, lon: 3.3 },
      { id: 'o2', lat: 6.6, lon: 3.4 },
    ]
    const warehouses: AllocationWarehouse[] = [
      { id: 'wh1', lat: 6.5, lon: 3.3, capacityUnits: 100, currentUnits: 0, inventory: new Map() },
      { id: 'wh2', lat: 6.6, lon: 3.4, capacityUnits: 100, currentUnits: 0, inventory: new Map() },
      { id: 'wh3', lat: 7.0, lon: 4.0, capacityUnits: 100, currentUnits: 0, inventory: new Map() },
    ]
    const matrix = buildCostMatrix(orders, warehouses)
    expect(matrix).toHaveLength(2)
    expect(matrix[0]).toHaveLength(3)
  })
})
