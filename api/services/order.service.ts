import { query, queryOne } from '../../core/db/pool'
import { logger } from '../../core/logger/logger'
import { AllocationOrder, AllocationWarehouse, buildCostMatrix } from '../../engines/allocation/bipartite-graph'
import { hungarian } from '../../engines/allocation/hungarian'
import { explainAllocation, whatIfExclude, AllocationDecision } from '../../engines/allocation/decision'
import { eventBus } from '../../core/events/event-bus'

export { AllocationDecision }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CreateOrderInput {
  orderNumber: string
  customerId?: string
  originAddress: Record<string, unknown>
  destinationAddress: Record<string, unknown>
  destLat?: number
  destLon?: number
  items: Array<{ sku: string; quantity: number; weightKg?: number; volumeCbm?: number }>
  totalWeightKg?: number
  totalVolumeCbm?: number
  scheduledDeliveryDate?: string
}

export async function createOrder(orgId: string, input: CreateOrderInput): Promise<Record<string, unknown>> {
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO orders (org_id, customer_id, order_number, origin_address, destination_address,
       dest_lat, dest_lon, items, total_weight_kg, total_volume_cbm, scheduled_delivery_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
     RETURNING *`,
    [
      orgId,
      input.customerId ?? null,
      input.orderNumber,
      JSON.stringify(input.originAddress),
      JSON.stringify(input.destinationAddress),
      input.destLat ?? null,
      input.destLon ?? null,
      JSON.stringify(input.items),
      input.totalWeightKg ?? null,
      input.totalVolumeCbm ?? null,
      input.scheduledDeliveryDate ?? null,
    ]
  )
  const order = rows[0]

  // Auto-allocate if coordinates are available
  if (input.destLat != null && input.destLon != null) {
    try {
      await runAllocation(orgId, order)
    } catch (err) {
      logger.warn('Auto-allocation failed, order stays pending', {
        orderId: order.id,
        error: (err as Error).message,
      })
    }
  }

  return order
}

async function runAllocation(
  orgId: string,
  order: Record<string, unknown>
): Promise<AllocationDecision | null> {
  // Fetch warehouses for this org — always scoped to org_id
  const whRows = await query<Record<string, unknown>>(
    `SELECT w.id, w.lat, w.lon, w.capacity_units, w.current_units,
            COALESCE(json_agg(json_build_object('sku', i.sku, 'quantity', i.quantity, 'reservedQuantity', i.reserved_quantity)) FILTER (WHERE i.sku IS NOT NULL), '[]') AS inventory
     FROM warehouses w
     LEFT JOIN warehouse_inventory i ON i.warehouse_id = w.id
     WHERE w.org_id = $1
     GROUP BY w.id`,
    [orgId]
  )

  if (whRows.length === 0) return null

  const allocationOrder: AllocationOrder = {
    id: order.id as string,
    lat: order.dest_lat as number,
    lon: order.dest_lon as number,
    // AllocationOrder uses weightKg, not totalWeightKg
    weightKg: order.total_weight_kg as number | undefined,
  }

  const allocationWarehouses: AllocationWarehouse[] = whRows.map(row => {
    const inv = new Map<string, { quantity: number; reservedQuantity: number }>()
    for (const item of row.inventory as Array<{ sku: string; quantity: number; reservedQuantity: number }>) {
      inv.set(item.sku, { quantity: item.quantity, reservedQuantity: item.reservedQuantity })
    }
    return {
      id: row.id as string,
      lat: parseFloat(row.lat as string),
      lon: parseFloat(row.lon as string),
      capacityUnits: row.capacity_units as number,
      currentUnits: row.current_units as number,
      inventory: inv,
    }
  })

  // Build cost matrix manually so we can pass it to explainAllocation
  const costMatrix = buildCostMatrix([allocationOrder], allocationWarehouses)
  const assignment = hungarian(costMatrix)
  const whIndex = assignment[0]

  if (whIndex < 0 || whIndex >= allocationWarehouses.length) return null

  const warehouseId = allocationWarehouses[whIndex].id

  await query(
    `UPDATE orders SET allocated_warehouse_id = $1, status = 'allocated', updated_at = NOW()
     WHERE id = $2 AND org_id = $3`,
    [warehouseId, order.id, orgId]
  )

  eventBus.emit('order.allocated', {
    orderId: order.id as string,
    warehouseId,
    orgId,
    allocatedAt: new Date().toISOString(),
  })

  logger.info('Order allocated', { orderId: order.id, warehouseId, orgId })

  return explainAllocation(allocationOrder, allocationWarehouses, whIndex, costMatrix)
}

export async function listOrders(
  orgId: string,
  opts: { status?: string; limit: number; offset: number }
): Promise<{ orders: Record<string, unknown>[]; total: number }> {
  const params: unknown[] = [orgId]
  let where = 'WHERE org_id = $1'

  if (opts.status) {
    params.push(opts.status)
    where += ` AND status = $${params.length}`
  }

  const limitIdx = params.length + 1
  const offsetIdx = params.length + 2

  const [orderRows, countRows] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, opts.limit, opts.offset]
    ),
    query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM orders ${where}`,
      params
    ),
  ])

  return {
    orders: orderRows,
    total: parseInt(countRows[0]?.total ?? '0', 10),
  }
}

export async function getOrder(orgId: string, orderId: string): Promise<Record<string, unknown> | null> {
  if (!UUID_RE.test(orderId)) return null
  return queryOne<Record<string, unknown>>(
    `SELECT o.*, w.name AS warehouse_name, w.lat AS warehouse_lat, w.lon AS warehouse_lon
     FROM orders o
     LEFT JOIN warehouses w ON w.id = o.allocated_warehouse_id
     WHERE o.id = $1 AND o.org_id = $2`,
    [orderId, orgId]
  )
}

export async function reallocateOrder(
  orgId: string,
  orderId: string
): Promise<{ order: Record<string, unknown>; decision: AllocationDecision | null } | null> {
  if (!UUID_RE.test(orderId)) return null

  const order = await queryOne<Record<string, unknown>>(
    'SELECT * FROM orders WHERE id = $1 AND org_id = $2',
    [orderId, orgId]
  )
  if (!order) return null

  const decision = await runAllocation(orgId, order)
  const updatedOrder = await getOrder(orgId, orderId)
  if (!updatedOrder) return null
  return { order: updatedOrder, decision }
}

// Fetch all warehouses for an org — used by what-if allocation route
export async function getWarehousesForOrg(orgId: string): Promise<AllocationWarehouse[]> {
  const whRows = await query<Record<string, unknown>>(
    `SELECT w.id, w.lat, w.lon, w.capacity_units, w.current_units,
            COALESCE(json_agg(json_build_object('sku', i.sku, 'quantity', i.quantity, 'reservedQuantity', i.reserved_quantity)) FILTER (WHERE i.sku IS NOT NULL), '[]') AS inventory
     FROM warehouses w
     LEFT JOIN warehouse_inventory i ON i.warehouse_id = w.id
     WHERE w.org_id = $1
     GROUP BY w.id`,
    [orgId]
  )
  return whRows.map(row => {
    const inv = new Map<string, { quantity: number; reservedQuantity: number }>()
    for (const item of row.inventory as Array<{ sku: string; quantity: number; reservedQuantity: number }>) {
      inv.set(item.sku, { quantity: item.quantity, reservedQuantity: item.reservedQuantity })
    }
    return {
      id: row.id as string,
      lat: parseFloat(row.lat as string),
      lon: parseFloat(row.lon as string),
      capacityUnits: row.capacity_units as number,
      currentUnits: row.current_units as number,
      inventory: inv,
    }
  })
}

// Re-export what-if function so the route doesn't need to import from engines directly
export { whatIfExclude }
