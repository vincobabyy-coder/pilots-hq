import { query, queryOne } from '../../core/db/pool'

export async function listWarehouses(
  orgId: string,
  limit: number,
  offset: number
): Promise<{ warehouses: unknown[]; total: number }> {
  const warehouses = await query<Record<string, unknown>>(
    `SELECT w.*,
       ROUND(CAST(w.current_units AS NUMERIC) / NULLIF(w.capacity_units, 0) * 100, 1) AS utilization_pct,
       COUNT(i.sku) AS sku_count
     FROM warehouses w
     LEFT JOIN warehouse_inventory i ON i.warehouse_id = w.id
     WHERE w.org_id = $1
     GROUP BY w.id
     ORDER BY w.name
     LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  )
  return { warehouses, total: warehouses.length }
}

export async function getWarehouse(
  orgId: string,
  id: string
): Promise<unknown | null> {
  return queryOne<Record<string, unknown>>(
    `SELECT w.*,
       ROUND(CAST(w.current_units AS NUMERIC) / NULLIF(w.capacity_units, 0) * 100, 1) AS utilization_pct,
       COUNT(i.sku) AS sku_count
     FROM warehouses w
     LEFT JOIN warehouse_inventory i ON i.warehouse_id = w.id
     WHERE w.org_id = $1 AND w.id = $2
     GROUP BY w.id
     ORDER BY w.name`,
    [orgId, id]
  )
}

export async function listInventory(
  orgId: string,
  warehouseId: string,
  limit: number,
  offset: number
): Promise<{ items: unknown[]; total: number }> {
  // Verify warehouse belongs to org before exposing inventory
  const warehouse = await queryOne<{ id: string }>(
    'SELECT id FROM warehouses WHERE id = $1 AND org_id = $2',
    [warehouseId, orgId]
  )
  if (!warehouse) return { items: [], total: -1 }  // sentinel: caller checks warehouse existence

  const [inventoryRows, countRows] = await Promise.all([
    query<Record<string, unknown>>(
      'SELECT * FROM warehouse_inventory WHERE warehouse_id = $1 ORDER BY sku LIMIT $2 OFFSET $3',
      [warehouseId, limit, offset]
    ),
    query<{ total: string }>(
      'SELECT COUNT(*) AS total FROM warehouse_inventory WHERE warehouse_id = $1',
      [warehouseId]
    ),
  ])

  const total = parseInt(countRows[0]?.total ?? '0', 10)
  return { items: inventoryRows, total }
}

export async function upsertInventory(
  orgId: string,
  warehouseId: string,
  sku: string,
  quantity: number,
  reservedQuantity: number,
  unitCost?: number | null
): Promise<unknown | null> {
  // Verify warehouse belongs to org
  const warehouse = await queryOne<{ id: string }>(
    'SELECT id FROM warehouses WHERE id = $1 AND org_id = $2',
    [warehouseId, orgId]
  )
  if (!warehouse) return null  // sentinel: caller handles 404

  // Upsert inventory row
  const inventoryRows = await query<Record<string, unknown>>(
    `INSERT INTO warehouse_inventory (warehouse_id, sku, quantity, reserved_quantity, unit_cost, last_updated)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (warehouse_id, sku) DO UPDATE SET
       quantity          = EXCLUDED.quantity,
       reserved_quantity = EXCLUDED.reserved_quantity,
       unit_cost         = COALESCE(EXCLUDED.unit_cost, warehouse_inventory.unit_cost),
       last_updated      = NOW()
     RETURNING *`,
    [warehouseId, sku, quantity, reservedQuantity, unitCost ?? null]
  )

  // Sync warehouses.current_units to the sum of all inventory quantities
  await query(
    `UPDATE warehouses
     SET current_units = (
       SELECT COALESCE(SUM(quantity), 0) FROM warehouse_inventory WHERE warehouse_id = $1
     ), updated_at = NOW()
     WHERE id = $1 AND org_id = $2`,
    [warehouseId, orgId]
  )

  return inventoryRows[0]
}
