// engines/allocation/bipartite-graph.ts
import { haversineKm } from '../route-optimizer/distance-matrix'

export interface AllocationOrder {
  id: string
  lat: number
  lon: number
  weightKg?: number
  volumeCbm?: number
  requiredSkus?: string[]  // SKUs this order needs in the warehouse
}

export interface AllocationWarehouse {
  id: string
  lat: number
  lon: number
  capacityUnits: number
  currentUnits: number
  inventory: Map<string, { quantity: number; reservedQuantity: number }>
}

export function buildCostMatrix(
  orders: AllocationOrder[],
  warehouses: AllocationWarehouse[]
): number[][] {
  if (orders.length === 0 || warehouses.length === 0) return []

  return orders.map(order => {
    return warehouses.map(wh => {
      // Distance cost
      let dist = haversineKm(order.lat, order.lon, wh.lat, wh.lon)
      if (!isFinite(dist) || isNaN(dist)) dist = 10_000

      // Inventory deficit penalty
      let inventoryPenalty = 0
      if (order.requiredSkus && order.requiredSkus.length > 0) {
        for (const sku of order.requiredSkus) {
          const inv = wh.inventory.get(sku)
          const available = inv ? inv.quantity - inv.reservedQuantity : 0
          if (available <= 0) inventoryPenalty += 1_000
        }
      }

      // Capacity penalty — guard against division by zero
      const capacityUnits = wh.capacityUnits > 0 ? wh.capacityUnits : 1
      const utilization = wh.currentUnits / capacityUnits
      const capacityPenalty = utilization > 0.8 ? utilization * 200 : 0

      return dist + inventoryPenalty + capacityPenalty
    })
  })
}
