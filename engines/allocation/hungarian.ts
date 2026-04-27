// engines/allocation/hungarian.ts
import { buildCostMatrix, AllocationOrder, AllocationWarehouse } from './bipartite-graph'

export class AllocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AllocationError'
  }
}

const PADDING = Number.MAX_SAFE_INTEGER / 2

export function hungarian(costMatrix: number[][]): number[] {
  if (costMatrix.length === 0) return []

  const numRows = costMatrix.length
  const numCols = costMatrix[0].length

  // Validate rectangular
  for (let i = 0; i < numRows; i++) {
    if (costMatrix[i].length !== numCols) {
      throw new AllocationError('Cost matrix must be rectangular (all rows same length)')
    }
  }

  // Pad to square
  const n = Math.max(numRows, numCols)
  const mat: number[][] = []
  for (let i = 0; i < n; i++) {
    mat.push([])
    for (let j = 0; j < n; j++) {
      if (i < numRows && j < numCols) {
        mat[i][j] = costMatrix[i][j]
      } else {
        mat[i][j] = PADDING
      }
    }
  }

  // Step 1: Row reduction
  for (let i = 0; i < n; i++) {
    const rowMin = Math.min(...mat[i])
    for (let j = 0; j < n; j++) mat[i][j] -= rowMin
  }

  // Step 2: Column reduction
  for (let j = 0; j < n; j++) {
    let colMin = Infinity
    for (let i = 0; i < n; i++) if (mat[i][j] < colMin) colMin = mat[i][j]
    for (let i = 0; i < n; i++) mat[i][j] -= colMin
  }

  const assignment = new Array<number>(n).fill(-1)
  const rowCovered = new Array<boolean>(n).fill(false)
  const colCovered = new Array<boolean>(n).fill(false)

  for (let iter = 0; iter < n * 2; iter++) {
    // Reset covers
    rowCovered.fill(false)
    colCovered.fill(false)
    assignment.fill(-1)

    // Greedy zero assignment
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (mat[i][j] === 0 && !colCovered[j]) {
          assignment[i] = j
          colCovered[j] = true
          break
        }
      }
    }

    // Count covered columns
    const coveredCount = colCovered.filter(Boolean).length
    if (coveredCount >= n) break

    // Find minimum uncovered value
    let minVal = Infinity
    for (let i = 0; i < n; i++) {
      if (rowCovered[i]) continue
      for (let j = 0; j < n; j++) {
        if (!colCovered[j] && mat[i][j] < minVal) minVal = mat[i][j]
      }
    }

    // Subtract from uncovered, add to double-covered
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!rowCovered[i] && !colCovered[j]) mat[i][j] -= minVal
        else if (rowCovered[i] && colCovered[j]) mat[i][j] += minVal
      }
    }

    // Cover rows with no assignment
    for (let i = 0; i < n; i++) {
      if (assignment[i] === -1) rowCovered[i] = true
    }
    // Cover columns of assigned zeros
    for (let i = 0; i < n; i++) {
      if (assignment[i] !== -1) colCovered[assignment[i]] = true
    }
  }

  // Return only the real rows (not padding rows), mapping out-of-bounds columns to -1
  return assignment.slice(0, numRows).map(j => (j < numCols ? j : -1))
}

export function allocate(
  orders: AllocationOrder[],
  warehouses: AllocationWarehouse[]
): Map<string, string> {
  if (orders.length === 0 || warehouses.length === 0) return new Map()
  const costMatrix = buildCostMatrix(orders, warehouses)
  const assignment = hungarian(costMatrix)
  const result = new Map<string, string>()
  for (let i = 0; i < orders.length; i++) {
    const whIndex = assignment[i]
    if (whIndex >= 0 && whIndex < warehouses.length) {
      result.set(orders[i].id, warehouses[whIndex].id)
    }
  }
  return result
}
