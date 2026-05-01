import { AllocationOrder, AllocationWarehouse, buildCostMatrix } from './bipartite-graph'
import { hungarian } from './hungarian'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AllocationFactor {
  factor: 'distance' | 'inventory' | 'capacity' | 'utilization'
  rawValue: number         // e.g. distanceKm, deficit count, utilisation %
  costContribution: number // how much this added to the cost matrix cell
  weight: number           // fraction of total cost (0.0–1.0)
  explanation: string      // human-readable explanation
}

export interface AllocationAlternative {
  warehouseId: string
  score: number            // lower = better (cost)
  costGap: number          // how much more expensive than winner (absolute)
  costGapPercent: number   // how much more expensive (%)
  wouldHaveBeenFeasible: boolean
}

export interface AllocationDecision {
  orderId: string
  assignedWarehouseId: string
  assignedCost: number
  factors: AllocationFactor[]
  alternatives: AllocationAlternative[]
  explanation: string   // one-sentence summary
  timestamp: string     // ISO-8601
}

// ---------------------------------------------------------------------------
// Haversine — inline to avoid cross-package boundary with route-optimizer
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ---------------------------------------------------------------------------
// Factor decomposition for a single order→warehouse pair
// ---------------------------------------------------------------------------

interface CostComponents {
  distanceKm: number
  inventoryPenalty: number
  capacityPenalty: number
  utilization: number
  missingSkuCount: number
}

function decomposeCost(order: AllocationOrder, wh: AllocationWarehouse): CostComponents {
  let distanceKm = haversineKm(order.lat, order.lon, wh.lat, wh.lon)
  if (!isFinite(distanceKm) || isNaN(distanceKm)) distanceKm = 10_000

  let inventoryPenalty = 0
  let missingSkuCount = 0
  if (order.requiredSkus && order.requiredSkus.length > 0) {
    for (const sku of order.requiredSkus) {
      const inv = wh.inventory.get(sku)
      const available = inv ? inv.quantity - inv.reservedQuantity : 0
      if (available <= 0) {
        inventoryPenalty += 1_000
        missingSkuCount++
      }
    }
  }

  const capacityUnits = wh.capacityUnits > 0 ? wh.capacityUnits : 1
  const utilization = wh.currentUnits / capacityUnits
  const capacityPenalty = utilization > 0.8 ? utilization * 200 : 0

  return { distanceKm, inventoryPenalty, capacityPenalty, utilization, missingSkuCount }
}

function buildFactors(
  order: AllocationOrder,
  wh: AllocationWarehouse,
  allWarehouses: AllocationWarehouse[]
): AllocationFactor[] {
  const { distanceKm, inventoryPenalty, capacityPenalty, utilization, missingSkuCount } =
    decomposeCost(order, wh)

  const totalCost = distanceKm + inventoryPenalty + capacityPenalty

  // Find the closest warehouse distance for context in explanation
  const allDistances = allWarehouses.map(w => haversineKm(order.lat, order.lon, w.lat, w.lon))
  const minDist = Math.min(...allDistances)
  const isClosest = Math.abs(distanceKm - minDist) < 0.001

  const factors: AllocationFactor[] = []

  // Distance factor
  factors.push({
    factor: 'distance',
    rawValue: distanceKm,
    costContribution: distanceKm,
    weight: totalCost > 0 ? distanceKm / totalCost : 1,
    explanation: isClosest
      ? `${distanceKm.toFixed(1)}km from delivery address (closest option)`
      : `${distanceKm.toFixed(1)}km from delivery address`,
  })

  // Inventory factor
  factors.push({
    factor: 'inventory',
    rawValue: missingSkuCount,
    costContribution: inventoryPenalty,
    weight: totalCost > 0 ? inventoryPenalty / totalCost : 0,
    explanation:
      missingSkuCount === 0
        ? 'All required SKUs available in stock'
        : `${missingSkuCount} required SKU(s) missing (+${inventoryPenalty} penalty)`,
  })

  // Capacity / utilisation factor
  const capacityContribution = capacityPenalty
  factors.push({
    factor: 'utilization',
    rawValue: utilization,
    costContribution: capacityContribution,
    weight: totalCost > 0 ? capacityContribution / totalCost : 0,
    explanation:
      utilization > 0.8
        ? `Warehouse ${(utilization * 100).toFixed(0)}% full (over 80% threshold, +${capacityContribution.toFixed(1)} penalty)`
        : `Warehouse ${(utilization * 100).toFixed(0)}% full (within capacity)`,
  })

  return factors
}

// ---------------------------------------------------------------------------
// explainAllocation — main export
// ---------------------------------------------------------------------------

export function explainAllocation(
  order: AllocationOrder,
  warehouses: AllocationWarehouse[],
  assignedWarehouseIndex: number,
  costMatrix: number[][]
): AllocationDecision {
  const assignedWarehouse = warehouses[assignedWarehouseIndex]
  const assignedCost = costMatrix[0][assignedWarehouseIndex]

  // Build alternatives from the remaining warehouses
  const alternatives: AllocationAlternative[] = warehouses
    .map((wh, idx) => {
      if (idx === assignedWarehouseIndex) return null
      const score = costMatrix[0][idx]
      const costGap = score - assignedCost
      const costGapPercent = assignedCost > 0 ? (costGap / assignedCost) * 100 : 0
      // A warehouse is feasible when it has no inventory penalty (all required SKUs present)
      const { inventoryPenalty } = decomposeCost(order, wh)
      const wouldHaveBeenFeasible = inventoryPenalty === 0
      return {
        warehouseId: wh.id,
        score,
        costGap,
        costGapPercent,
        wouldHaveBeenFeasible,
      } satisfies AllocationAlternative
    })
    .filter((a): a is AllocationAlternative => a !== null)
    .sort((a, b) => a.score - b.score)  // best alternative first

  // Build factors by decomposing the winning warehouse's cost
  const factors = buildFactors(order, assignedWarehouse, warehouses)

  // One-sentence summary
  const runnerUp = alternatives[0]
  const explanation =
    runnerUp != null
      ? `Assigned to warehouse ${assignedWarehouse.id} (cost ${assignedCost.toFixed(1)}). ` +
        `Next best was ${runnerUp.warehouseId} (+${runnerUp.costGap.toFixed(1)}, ${runnerUp.costGapPercent.toFixed(0)}% more expensive).`
      : `Assigned to warehouse ${assignedWarehouse.id} (cost ${assignedCost.toFixed(1)}); no alternatives available.`

  return {
    orderId: order.id,
    assignedWarehouseId: assignedWarehouse.id,
    assignedCost,
    factors,
    alternatives,
    explanation,
    timestamp: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// whatIfExclude — re-run allocation excluding certain warehouses
// ---------------------------------------------------------------------------

export function whatIfExclude(
  order: AllocationOrder,
  warehouses: AllocationWarehouse[],
  excludeWarehouseIds: string[]
): { assignedWarehouseId: string | null; decision: AllocationDecision | null } {
  const excluded = new Set(excludeWarehouseIds)
  const remaining = warehouses.filter(wh => !excluded.has(wh.id))

  if (remaining.length === 0) {
    return { assignedWarehouseId: null, decision: null }
  }

  const costMatrix = buildCostMatrix([order], remaining)
  const assignment = hungarian(costMatrix)
  const whIndex = assignment[0]

  if (whIndex < 0 || whIndex >= remaining.length) {
    return { assignedWarehouseId: null, decision: null }
  }

  const decision = explainAllocation(order, remaining, whIndex, costMatrix)
  return { assignedWarehouseId: remaining[whIndex].id, decision }
}
