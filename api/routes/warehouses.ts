import { Router } from '../../core/http/router'
import { query, queryOne } from '../../core/db/pool'
import { logger } from '../../core/logger/logger'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SKU_RE  = /^[a-zA-Z0-9_\-]{1,100}$/

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function warehousesRouter(): Router {
  const router = new Router()

  // GET / — list warehouses with utilization and SKU count
  router.get('/', async (req, res) => {
    const q = req.query as Record<string, string>

    const rawLimit = q.limit ? parseInt(q.limit, 10) : 20
    const limit = Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100)
    const rawOffset = q.offset ? parseInt(q.offset, 10) : 0
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset

    try {
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
        [req.orgId!, limit, offset]
      )
      res.ok({ warehouses, meta: { limit, offset } })
    } catch (err) {
      logger.error('Failed to list warehouses', { orgId: req.orgId, error: (err as Error).message })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // GET /:id — single warehouse with inventory summary
  router.get('/:id', async (req, res) => {
    const { id } = req.params

    if (!UUID_RE.test(id)) {
      res.status(400).fail('VALIDATION_ERROR', 'id must be a valid UUID', 400); return
    }

    try {
      const warehouse = await queryOne<Record<string, unknown>>(
        `SELECT w.*,
           ROUND(CAST(w.current_units AS NUMERIC) / NULLIF(w.capacity_units, 0) * 100, 1) AS utilization_pct,
           COUNT(i.sku) AS sku_count
         FROM warehouses w
         LEFT JOIN warehouse_inventory i ON i.warehouse_id = w.id
         WHERE w.org_id = $1 AND w.id = $2
         GROUP BY w.id
         ORDER BY w.name`,
        [req.orgId!, id]
      )

      if (!warehouse) {
        res.status(404).fail('WAREHOUSE_NOT_FOUND', 'Warehouse not found', 404); return
      }
      res.ok({ warehouse })
    } catch (err) {
      logger.error('Failed to get warehouse', { orgId: req.orgId, warehouseId: id, error: (err as Error).message })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // GET /:id/inventory — list inventory for a warehouse
  router.get('/:id/inventory', async (req, res) => {
    const { id } = req.params

    if (!UUID_RE.test(id)) {
      res.status(400).fail('VALIDATION_ERROR', 'id must be a valid UUID', 400); return
    }

    const q = req.query as Record<string, string>
    const rawLimit = q.limit ? parseInt(q.limit, 10) : 20
    const limit = Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100)
    const rawOffset = q.offset ? parseInt(q.offset, 10) : 0
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset

    try {
      // Verify warehouse belongs to org before exposing inventory
      const warehouse = await queryOne<{ id: string }>(
        'SELECT id FROM warehouses WHERE id = $1 AND org_id = $2',
        [id, req.orgId!]
      )
      if (!warehouse) {
        res.status(404).fail('WAREHOUSE_NOT_FOUND', 'Warehouse not found', 404); return
      }

      const [inventoryRows, countRows] = await Promise.all([
        query<Record<string, unknown>>(
          'SELECT * FROM warehouse_inventory WHERE warehouse_id = $1 ORDER BY sku LIMIT $2 OFFSET $3',
          [id, limit, offset]
        ),
        query<{ total: string }>(
          'SELECT COUNT(*) AS total FROM warehouse_inventory WHERE warehouse_id = $1',
          [id]
        ),
      ])

      const total = parseInt(countRows[0]?.total ?? '0', 10)
      res.ok({ inventory: inventoryRows, meta: { total, limit, offset } })
    } catch (err) {
      logger.error('Failed to list inventory', { orgId: req.orgId, warehouseId: id, error: (err as Error).message })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // PATCH /:id/inventory/:sku — upsert inventory line
  router.patch('/:id/inventory/:sku', async (req, res) => {
    const { id, sku } = req.params

    if (!UUID_RE.test(id)) {
      res.status(400).fail('VALIDATION_ERROR', 'id must be a valid UUID', 400); return
    }

    // Validate SKU path param — prevents injection via SKU
    if (!SKU_RE.test(sku)) {
      res.status(400).fail('VALIDATION_ERROR', 'sku must be alphanumeric with underscores/hyphens, max 100 chars', 400); return
    }

    const body = req.body as Record<string, unknown>

    // Body field validation
    const fieldErrors: Array<{ field: string; message: string }> = []

    if (body.quantity !== undefined) {
      if (typeof body.quantity !== 'number' || isNaN(body.quantity)) {
        fieldErrors.push({ field: 'quantity', message: 'quantity must be a number' })
      } else if (body.quantity < 0) {
        fieldErrors.push({ field: 'quantity', message: 'quantity must be >= 0' })
      }
    }

    if (body.reservedQuantity !== undefined) {
      if (typeof body.reservedQuantity !== 'number' || isNaN(body.reservedQuantity)) {
        fieldErrors.push({ field: 'reservedQuantity', message: 'reservedQuantity must be a number' })
      } else if (body.reservedQuantity < 0) {
        fieldErrors.push({ field: 'reservedQuantity', message: 'reservedQuantity must be >= 0' })
      }
    }

    // Cross-field: reservedQuantity <= quantity (only when both are valid numbers)
    const qty = body.quantity as number | undefined
    const resQty = body.reservedQuantity as number | undefined
    if (
      typeof qty === 'number' && !isNaN(qty) &&
      typeof resQty === 'number' && !isNaN(resQty) &&
      resQty > qty
    ) {
      fieldErrors.push({ field: 'reservedQuantity', message: 'reservedQuantity must be <= quantity' })
    }

    if (body.unitCost !== undefined && (typeof body.unitCost !== 'number' || isNaN(body.unitCost))) {
      fieldErrors.push({ field: 'unitCost', message: 'unitCost must be a number' })
    }

    if (fieldErrors.length > 0) {
      res.status(400).fail('VALIDATION_ERROR', 'Invalid inventory fields', 400, fieldErrors); return
    }

    try {
      // Verify warehouse belongs to org
      const warehouse = await queryOne<{ id: string }>(
        'SELECT id FROM warehouses WHERE id = $1 AND org_id = $2',
        [id, req.orgId!]
      )
      if (!warehouse) {
        res.status(404).fail('WAREHOUSE_NOT_FOUND', 'Warehouse not found', 404); return
      }

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
        [
          id,
          sku,
          body.quantity ?? 0,
          body.reservedQuantity ?? 0,
          body.unitCost ?? null,
        ]
      )

      // Sync warehouses.current_units to the sum of all inventory quantities
      await query(
        `UPDATE warehouses
         SET current_units = (
           SELECT COALESCE(SUM(quantity), 0) FROM warehouse_inventory WHERE warehouse_id = $1
         ), updated_at = NOW()
         WHERE id = $1 AND org_id = $2`,
        [id, req.orgId!]
      )

      res.ok({ inventory: inventoryRows[0] })
    } catch (err) {
      logger.error('Failed to upsert inventory', { orgId: req.orgId, warehouseId: id, sku, error: (err as Error).message })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  return router
}
