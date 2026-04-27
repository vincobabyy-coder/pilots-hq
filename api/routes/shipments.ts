import { Router } from '../../core/http/router'
import * as shipmentService from '../services/shipment.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(
  err: unknown,
  res: { status: (code: number) => { fail: (code: string, msg: string, status: number) => void } }
): void {
  const e = err as { statusCode?: number; code?: string; message?: string }
  if (e.statusCode) {
    res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
    return
  }
  throw err
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function shipmentsRouter(): Router {
  const router = new Router()

  // POST / — create shipment
  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // Validate orderIds — required non-empty array of strings
    if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'orderIds must be a non-empty array', 400); return
    }
    if (!body.orderIds.every((x: unknown) => typeof x === 'string')) {
      res.status(400).fail('VALIDATION_ERROR', 'orderIds must be an array of strings', 400); return
    }

    // Validate destinationAddress — required object
    if (
      body.destinationAddress === undefined ||
      body.destinationAddress === null ||
      typeof body.destinationAddress !== 'object' ||
      Array.isArray(body.destinationAddress)
    ) {
      res.status(400).fail('VALIDATION_ERROR', 'destinationAddress is required and must be an object', 400); return
    }

    // Optional numeric fields
    if (body.destLat !== undefined && typeof body.destLat !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'destLat must be a number', 400); return
    }
    if (body.destLon !== undefined && typeof body.destLon !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'destLon must be a number', 400); return
    }
    if (body.originWarehouseId !== undefined && typeof body.originWarehouseId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'originWarehouseId must be a string', 400); return
    }
    if (body.estimatedDelivery !== undefined && typeof body.estimatedDelivery !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'estimatedDelivery must be a string', 400); return
    }

    try {
      const shipment = await shipmentService.createShipment({
        orgId: req.orgId!,
        orderIds: body.orderIds as string[],
        originWarehouseId: body.originWarehouseId as string | undefined,
        destinationAddress: body.destinationAddress as Record<string, unknown>,
        destLat: body.destLat as number | undefined,
        destLon: body.destLon as number | undefined,
        estimatedDelivery: body.estimatedDelivery as string | undefined,
      })
      res.status(201).ok({ shipment })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET / — list shipments
  router.get('/', async (req, res) => {
    const query = req.query as Record<string, string>

    const status = query.status
    const page = query.page ? parseInt(query.page, 10) : 1
    const rawLimit = query.limit ? parseInt(query.limit, 10) : 20
    const limit = Math.min(rawLimit, 100)

    try {
      const { shipments, total } = await shipmentService.listShipments(req.orgId!, { status, page, limit })
      res.ok({ shipments, total, page, limit })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /:id — get single shipment
  router.get('/:id', async (req, res) => {
    try {
      const shipment = await shipmentService.getShipment(req.orgId!, req.params.id)
      if (!shipment) {
        res.status(404).fail('SHIPMENT_NOT_FOUND', 'Shipment not found', 404); return
      }
      res.ok({ shipment })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /:id/events — event log
  router.get('/:id/events', async (req, res) => {
    try {
      const events = await shipmentService.getShipmentEvents(req.orgId!, req.params.id)
      res.ok({ events })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // PATCH /:id/exception — mark exception
  router.patch('/:id/exception', async (req, res) => {
    const body = req.body as Record<string, unknown>

    if (!body.reason || typeof body.reason !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'reason is required and must be a string', 400); return
    }

    try {
      const shipment = await shipmentService.markException(
        req.orgId!,
        req.params.id,
        body.reason as string
      )
      res.ok({ shipment })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  return router
}
