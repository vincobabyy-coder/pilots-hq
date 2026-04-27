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

  for (let i = 0; i < numRows; i++) {
    if (costMatrix[i].length !== numCols) {
      throw new AllocationError('Cost matrix must be rectangular (all rows same length)')
    }
  }

  const n = Math.max(numRows, numCols)

  // Accessor for padded n×n matrix (1-indexed: rows 1..n, cols 1..n)
  const mat = (i: number, j: number): number => {
    const r = i - 1
    const c = j - 1
    return r < numRows && c < numCols ? costMatrix[r][c] : PADDING
  }

  // Kuhn-Munkres "shortest augmenting path" variant — O(n³), provably correct
  // u[i] = row potential, v[j] = column potential (1-indexed)
  // p[j] = row currently assigned to column j (0 = unassigned)
  const u   = new Array<number>(n + 1).fill(0)
  const v   = new Array<number>(n + 1).fill(0)
  const p   = new Array<number>(n + 1).fill(0)
  const way = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minDist = new Array<number>(n + 1).fill(Infinity)
    const used    = new Array<boolean>(n + 1).fill(false)

    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = -1

      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = mat(i0, j) - u[i0] - v[j]
          if (cur < minDist[j]) { minDist[j] = cur; way[j] = j0 }
          if (minDist[j] < delta) { delta = minDist[j]; j1 = j }
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta }
        else minDist[j] -= delta
      }

      j0 = j1 as number
    } while (p[j0] !== 0)

    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }

  // Build 0-indexed assignment for rows 0..numRows-1
  const assignment = new Array<number>(numRows).fill(-1)
  for (let j = 1; j <= n; j++) {
    const row = p[j] - 1
    if (row >= 0 && row < numRows) {
      assignment[row] = (j - 1) < numCols ? j - 1 : -1
    }
  }
  return assignment
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
