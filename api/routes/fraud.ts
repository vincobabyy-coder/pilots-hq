import { Router } from '../../core/http/router'
import { detectAnomaly, detectAnomalies } from '../../engines/fraud/detector'
import type { DetectorConfig } from '../../engines/fraud/detector'
import { trainBaseline, getBaseline } from '../../engines/fraud/baseline'
import { initCusumState, processBatch } from '../../engines/fraud/cusum'
import { logger } from '../../core/logger/logger'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(err: unknown, res: import('../../core/http/types').PilotsResponse, req?: { path: string; method: string }): void {
  logger.error('Handler error', { error: (err as Error).message, path: req?.path, method: req?.method })
  res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function fraudRouter(): Router {
  const router = new Router()

  // POST /detect — detect a single metric observation against baseline
  router.post('/detect', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // metric — required non-empty string
    if (!body.metric || typeof body.metric !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'metric is required and must be a non-empty string', 400); return
    }

    // value — required number
    if (typeof body.value !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'value is required and must be a number', 400); return
    }

    try {
      const result = await detectAnomaly(
        req.orgId!,
        body.metric as string,
        body.value as number,
        body.config as DetectorConfig | undefined
      )
      res.ok({ result })
    } catch (err) {
      handleServiceError(err, res, req)
    }
  })

  // POST /detect-batch — detect anomalies across a batch of observations
  router.post('/detect-batch', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // observations — required non-empty array
    if (!Array.isArray(body.observations) || body.observations.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'observations is required and must be a non-empty array', 400); return
    }

    try {
      const results = await detectAnomalies(
        req.orgId!,
        body.observations as Array<{ metric: string; value: number }>,
        undefined,
        body.returnAll as boolean | undefined
      )
      res.ok({ results })
    } catch (err) {
      handleServiceError(err, res, req)
    }
  })

  // POST /baseline/train — train a baseline from historical values
  router.post('/baseline/train', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // metric — required non-empty string
    if (!body.metric || typeof body.metric !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'metric is required and must be a non-empty string', 400); return
    }

    // values — required non-empty number array, max 10 000 items
    if (!Array.isArray(body.values) || body.values.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'values is required and must be a non-empty array', 400); return
    }

    if ((body.values as unknown[]).length > 10_000) {
      res.status(400).fail('VALIDATION_ERROR', 'values must contain at most 10,000 items', 400); return
    }

    for (let i = 0; i < (body.values as unknown[]).length; i++) {
      if (typeof (body.values as unknown[])[i] !== 'number') {
        res.status(400).fail('VALIDATION_ERROR', `values[${i}] must be a number`, 400); return
      }
    }

    try {
      const baseline = await trainBaseline(
        req.orgId!,
        body.metric as string,
        body.values as number[]
      )
      res.ok({ baseline })
    } catch (err) {
      handleServiceError(err, res, req)
    }
  })

  // GET /baseline/:metric — fetch stored baseline for a metric
  router.get('/baseline/:metric', async (req, res) => {
    // URL-decode in case the metric contains special chars (e.g. slashes encoded as %2F)
    const metric = decodeURIComponent(req.params.metric)

    try {
      const baseline = await getBaseline(req.orgId!, metric)

      if (baseline === null) {
        res.status(404).fail('NOT_FOUND', 'Baseline not found', 404); return
      }

      res.ok({ baseline })
    } catch (err) {
      handleServiceError(err, res, req)
    }
  })

  // POST /cusum — run CUSUM change-point detection over a batch of observations
  router.post('/cusum', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // mean — required number
    if (typeof body.mean !== 'number') {
      res.status(400).fail('VALIDATION_ERROR', 'mean is required and must be a number', 400); return
    }

    // sigma — required number >= 0
    if (typeof body.sigma !== 'number' || body.sigma < 0) {
      res.status(400).fail('VALIDATION_ERROR', 'sigma is required and must be a number >= 0', 400); return
    }

    // observations — required non-empty array of numbers
    if (!Array.isArray(body.observations) || body.observations.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'observations is required and must be a non-empty array', 400); return
    }

    for (let i = 0; i < (body.observations as unknown[]).length; i++) {
      if (typeof (body.observations as unknown[])[i] !== 'number') {
        res.status(400).fail('VALIDATION_ERROR', `observations[${i}] must be a number`, 400); return
      }
    }

    try {
      const state = initCusumState(body.mean as number, body.sigma as number)
      const results = processBatch(state, body.observations as number[])
      res.ok({ results, finalState: results[results.length - 1].newState })
    } catch (err) {
      handleServiceError(err, res, req)
    }
  })

  return router
}
