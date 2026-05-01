import { Router } from '../../core/http/router'
import * as orderService from '../services/order.service'
import { AllocationOrder } from '../../engines/allocation/bipartite-graph'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function ordersRouter(): Router {
  const router = new Router()

  // POST / — create order
  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // orderNumber — required string
    if (!body.orderNumber || typeof body.orderNumber !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'orderNumber is required and must be a string', 400); return
    }

    // destinationAddress — required object
    if (
      body.destinationAddress === undefined ||
      body.destinationAddress === null ||
      typeof body.destinationAddress !== 'object' ||
      Array.isArray(body.destinationAddress)
    ) {
      res.status(400).fail('VALIDATION_ERROR', 'destinationAddress is required and must be an object', 400); return
    }

    // items — required non-empty array
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'items is required and must be a non-empty array', 400); return
    }

    // Optional field types
    if (body.customerId !== undefined && typeof body.customerId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'customerId must be a string', 400); return
    }
    if (body.destLat !== undefined && typeof body.destLat !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'destLat must be a number', 400); return
    }
    if (body.destLon !== undefined && typeof body.destLon !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'destLon must be a number', 400); return
    }
    if (body.totalWeightKg !== undefined && typeof body.totalWeightKg !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'totalWeightKg must be a number', 400); return
    }
    if (body.totalVolumeCbm !== undefined && typeof body.totalVolumeCbm !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'totalVolumeCbm must be a number', 400); return
    }
    if (body.scheduledDeliveryDate !== undefined && typeof body.scheduledDeliveryDate !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'scheduledDeliveryDate must be a string', 400); return
    }
    if (
      body.originAddress !== undefined && (
        body.originAddress === null ||
        typeof body.originAddress !== 'object' ||
        Array.isArray(body.originAddress)
      )
    ) {
      res.status(400).fail('VALIDATION_ERROR', 'originAddress must be an object', 400); return
    }

    try {
      const order = await orderService.createOrder(req.orgId!, {
        orderNumber: body.orderNumber as string,
        customerId: body.customerId as string | undefined,
        originAddress: (body.originAddress ?? {}) as Record<string, unknown>,
        destinationAddress: body.destinationAddress as Record<string, unknown>,
        destLat: body.destLat as number | undefined,
        destLon: body.destLon as number | undefined,
        items: body.items as Array<{ sku: string; quantity: number; weightKg?: number; volumeCbm?: number }>,
        totalWeightKg: body.totalWeightKg as number | undefined,
        totalVolumeCbm: body.totalVolumeCbm as number | undefined,
        scheduledDeliveryDate: body.scheduledDeliveryDate as string | undefined,
      })
      res.status(201).ok({ order })
    } catch (err) {
      const e = err as Error
      // Log but never leak raw error messages to clients
      void e
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // GET / — list orders
  router.get('/', async (req, res) => {
    const q = req.query as Record<string, string>

    const status = q.status
    const rawLimit = q.limit ? parseInt(q.limit, 10) : 20
    const limit = Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100)
    const rawOffset = q.offset ? parseInt(q.offset, 10) : 0
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset

    try {
      const { orders, total } = await orderService.listOrders(req.orgId!, { status, limit, offset })
      res.ok({ orders, meta: { total, limit, offset } })
    } catch (err) {
      void err
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // GET /:id — get single order
  router.get('/:id', async (req, res) => {
    const { id } = req.params

    if (!UUID_RE.test(id)) {
      res.status(400).fail('VALIDATION_ERROR', 'id must be a valid UUID', 400); return
    }

    try {
      const order = await orderService.getOrder(req.orgId!, id)
      if (!order) {
        res.status(404).fail('ORDER_NOT_FOUND', 'Order not found', 404); return
      }
      res.ok({ order })
    } catch (err) {
      void err
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // POST /:id/allocate — trigger (re)allocation for an order
  router.post('/:id/allocate', async (req, res) => {
    const { id } = req.params

    if (!UUID_RE.test(id)) {
      res.status(400).fail('VALIDATION_ERROR', 'id must be a valid UUID', 400); return
    }

    try {
      const result = await orderService.reallocateOrder(req.orgId!, id)
      if (!result) {
        res.status(404).fail('ORDER_NOT_FOUND', 'Order not found', 404); return
      }
      const { order, decision } = result
      res.ok({
        orderId: order.id as string,
        allocatedWarehouseId: order.allocated_warehouse_id as string | null,
        decision,
      })
    } catch (err) {
      void err
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  // POST /what-if-allocate — re-run allocation excluding specific warehouses
  router.post('/what-if-allocate', async (req, res) => {
    const body = req.body as Record<string, unknown>

    if (!body.orderId || typeof body.orderId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'orderId is required and must be a string', 400); return
    }
    if (!UUID_RE.test(body.orderId)) {
      res.status(400).fail('VALIDATION_ERROR', 'orderId must be a valid UUID', 400); return
    }
    if (!Array.isArray(body.excludeWarehouseIds)) {
      res.status(400).fail('VALIDATION_ERROR', 'excludeWarehouseIds must be an array', 400); return
    }

    const excludeWarehouseIds = body.excludeWarehouseIds as string[]

    try {
      const order = await orderService.getOrder(req.orgId!, body.orderId)
      if (!order) {
        res.status(404).fail('ORDER_NOT_FOUND', 'Order not found', 404); return
      }

      const warehouses = await orderService.getWarehousesForOrg(req.orgId!)

      const allocationOrder: AllocationOrder = {
        id: order.id as string,
        lat: order.dest_lat as number,
        lon: order.dest_lon as number,
        weightKg: order.total_weight_kg as number | undefined,
      }

      const result = orderService.whatIfExclude(allocationOrder, warehouses, excludeWarehouseIds)

      if (result.assignedWarehouseId === null) {
        res.status(422).fail('NO_WAREHOUSES_AVAILABLE', 'No warehouses available after exclusion', 422); return
      }

      res.ok({ result })
    } catch (err) {
      void err
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  return router
}
