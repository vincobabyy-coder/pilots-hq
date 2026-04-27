import { Router } from '../../core/http/router'
import { logger } from '../../core/logger/logger'
import {
  listWarehouses,
  getWarehouse,
  listInventory,
  upsertInventory,
} from '../services/warehouse.service'

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
      const { warehouses } = await listWarehouses(req.orgId!, limit, offset)
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
      const warehouse = await getWarehouse(req.orgId!, id)

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
      const result = await listInventory(req.orgId!, id, limit, offset)

      // total === -1 is the sentinel meaning warehouse not found
      if (result.total === -1) {
        res.status(404).fail('WAREHOUSE_NOT_FOUND', 'Warehouse not found', 404); return
      }

      res.ok({ inventory: result.items, meta: { total: result.total, limit, offset } })
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
      const inventory = await upsertInventory(
        req.orgId!,
        id,
        sku,
        (body.quantity as number) ?? 0,
        (body.reservedQuantity as number) ?? 0,
        body.unitCost as number | undefined
      )

      if (!inventory) {
        res.status(404).fail('WAREHOUSE_NOT_FOUND', 'Warehouse not found', 404); return
      }

      res.ok({ inventory })
    } catch (err) {
      logger.error('Failed to upsert inventory', { orgId: req.orgId, warehouseId: id, sku, error: (err as Error).message })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  return router
}
