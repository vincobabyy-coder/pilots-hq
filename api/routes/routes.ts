import { Router } from '../../core/http/router'
import { v } from '../../core/validation/schema'
import * as routeService from '../services/route.service'
import { startWorker } from '../../core/queue/simple-queue'
import { SolverInput } from '../../engines/route-optimizer/types'
import { logger } from '../../core/logger/logger'

const optimizeSchema = v.object({
  warehouseId: v.string().required(),
  date: v.string().required(),
  vehicleIds: v.string(),  // validated manually below — v doesn't have array type
  orderIds: v.string(),    // validated manually below
})

const confirmSchema = v.object({
  driverId: v.string().required(),
})

export function routesRouter(): Router {
  const router = new Router()

  // POST /optimize
  router.post('/optimize', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // Manual validation for required fields (v doesn't support arrays)
    if (!body.warehouseId || typeof body.warehouseId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'warehouseId is required', 400); return
    }
    if (!body.date || typeof body.date !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'date is required', 400); return
    }
    if (!Array.isArray(body.vehicleIds) || body.vehicleIds.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'vehicleIds must be a non-empty array', 400); return
    }
    if (!body.vehicleIds.every((x: unknown) => typeof x === 'string')) {
      res.status(400).fail('VALIDATION_ERROR', 'vehicleIds must be an array of strings', 400); return
    }
    if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'orderIds must be a non-empty array', 400); return
    }
    if (!body.orderIds.every((x: unknown) => typeof x === 'string')) {
      res.status(400).fail('VALIDATION_ERROR', 'orderIds must be an array of strings', 400); return
    }

    try {
      const jobId = await routeService.optimizeRoutes(req.orgId!, {
        warehouseId: body.warehouseId as string,
        date: body.date as string,
        vehicleIds: body.vehicleIds as string[],
        orderIds: body.orderIds as string[],
      })
      res.ok({ jobId })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string; message?: string }
      if (e.statusCode) {
        res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
        return
      }
      throw err
    }
  })

  // GET /jobs/:jobId
  router.get('/jobs/:jobId', async (req, res) => {
    const job = await routeService.getJobStatus(req.params.jobId)
    if (!job) {
      res.status(404).fail('JOB_NOT_FOUND', 'Job not found', 404)
      return
    }
    res.ok({ job })
  })

  // GET /:id
  router.get('/:id', async (req, res) => {
    try {
      const route = await routeService.getRoute(req.orgId!, req.params.id)
      if (!route) {
        res.status(404).fail('ROUTE_NOT_FOUND', 'Route not found', 404)
        return
      }
      res.ok({ route })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string; message?: string }
      if (e.statusCode) {
        res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
        return
      }
      throw err
    }
  })

  // POST /:id/confirm
  router.post('/:id/confirm', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const result = confirmSchema.parse(body)
    if (!result.ok) {
      res.status(400).fail('VALIDATION_ERROR', 'Invalid input', 400, result.errors)
      return
    }

    try {
      const route = await routeService.confirmRoute(
        req.orgId!,
        req.params.id,
        result.data.driverId as string
      )
      res.ok({ route })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string; message?: string }
      if (e.statusCode) {
        res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
        return
      }
      throw err
    }
  })

  // POST /:id/complete
  router.post('/:id/complete', async (req, res) => {
    const body = req.body as Record<string, unknown>

    if (!body.startedAt || typeof body.startedAt !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'startedAt is required', 400); return
    }
    if (!Array.isArray(body.stopActualArrivalMinutes) || body.stopActualArrivalMinutes.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'stopActualArrivalMinutes must be a non-empty array', 400); return
    }
    if (!body.stopActualArrivalMinutes.every((x: unknown) => typeof x === 'number' && x >= 0)) {
      res.status(400).fail('VALIDATION_ERROR', 'stopActualArrivalMinutes must be an array of non-negative numbers', 400); return
    }

    try {
      const route = await routeService.completeRoute(
        req.orgId!,
        req.params.id,
        {
          startedAt: body.startedAt as string,
          stopActualArrivalMinutes: body.stopActualArrivalMinutes as number[],
        }
      )
      res.ok({ route })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string; message?: string }
      if (e.statusCode) {
        res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
        return
      }
      throw err
    }
  })

  // PATCH /:id/reassign
  router.patch('/:id/reassign', async (req, res) => {
    const body = req.body as Record<string, unknown>

    const driverId = body.driverId as string | undefined
    const vehicleId = body.vehicleId as string | undefined

    if (!driverId && !vehicleId) {
      res.status(400).fail('VALIDATION_ERROR', 'At least one of driverId or vehicleId must be provided', 400)
      return
    }

    if (driverId !== undefined && typeof driverId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'driverId must be a string', 400)
      return
    }

    if (vehicleId !== undefined && typeof vehicleId !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'vehicleId must be a string', 400)
      return
    }

    try {
      const route = await routeService.reassignRoute(
        req.orgId!,
        req.params.id,
        driverId,
        vehicleId
      )
      res.ok({ route })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string; message?: string }
      if (e.statusCode) {
        res.status(e.statusCode).fail(e.code ?? 'ERROR', e.message ?? 'Error', e.statusCode)
        return
      }
      throw err
    }
  })

  return router
}

// Start the route optimization worker when this module loads
const worker = startWorker<{ orgId: string; warehouseId: string; input: SolverInput }>('route-optimization', async (job) => {
  await routeService.runOptimizationJob(job.payload.orgId, job.payload.warehouseId, job.payload.input)
})
logger.info('Route optimization worker started')
// worker is kept running as long as the process is alive
void worker
