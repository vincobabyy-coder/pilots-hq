import { Router } from '../../core/http/router'
import * as shipmentService from '../services/shipment.service'
import { logger } from '../../core/logger/logger'

export function driversRouter(): Router {
  const router = new Router()

  // PATCH /:id/location — update driver's current location
  router.patch('/:id/location', async (req, res) => {
    const body = req.body as Record<string, unknown>

    if (body.lat === undefined || body.lat === null || typeof body.lat !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'lat is required and must be a number', 400); return
    }
    if (body.lon === undefined || body.lon === null || typeof body.lon !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'lon is required and must be a number', 400); return
    }

    try {
      await shipmentService.updateDriverLocation(
        req.orgId!,
        req.params.id,
        body.lat as number,
        body.lon as number
      )
      res.ok({ updated: true })
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string }
      if (e.statusCode) {
        res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
        return
      }
      logger.error('Handler error', { error: (err as Error).message, path: req.path, method: req.method })
      res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
    }
  })

  return router
}
