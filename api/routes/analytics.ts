import { Router } from '../../core/http/router'
import { forecastDemand } from '../../engines/analytics/demand-forecast'
import { predictDelivery } from '../../engines/analytics/delivery-predictor'
import { computePercentiles, buildHistogram, percentileFromHistogram } from '../../engines/analytics/percentile'
import { decompose } from '../../engines/analytics/time-series'
import { query } from '../../core/db/pool'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(err: unknown, res: import('../../core/http/types').PilotsResponse): void {
  void err
  res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function analyticsRouter(): Router {
  const router = new Router()

  // POST /forecast — demand forecast from historical data
  router.post('/forecast', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // data — required non-empty array
    if (!Array.isArray(body.data) || body.data.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'data is required and must be a non-empty array', 400); return
    }

    // periodLength — required integer >= 2
    if (typeof body.periodLength !== 'number' || body.periodLength < 2) {
      res.status(400).fail('VALIDATION_ERROR', 'periodLength is required and must be a number >= 2', 400); return
    }

    // horizonSteps — required integer >= 1
    if (typeof body.horizonSteps !== 'number' || body.horizonSteps < 1) {
      res.status(400).fail('VALIDATION_ERROR', 'horizonSteps is required and must be a number >= 1', 400); return
    }

    try {
      const forecast = forecastDemand(
        body.data as Array<{ timestamp: number; value: number }>,
        body.periodLength as number,
        body.horizonSteps as number
      )
      res.ok({ forecast })
    } catch (err) {
      const e = err as Error
      res.status(422).fail('FORECAST_ERROR', e.message, 422)
    }
  })

  // POST /predict-delivery — estimated delivery time along a multi-stop route
  router.post('/predict-delivery', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // stops — required array of >= 2 objects each with numeric lat/lon
    if (!Array.isArray(body.stops) || body.stops.length < 2) {
      res.status(400).fail('VALIDATION_ERROR', 'stops is required and must be an array of at least 2 items', 400); return
    }

    for (let i = 0; i < (body.stops as unknown[]).length; i++) {
      const stop = (body.stops as unknown[])[i]
      if (
        stop === null ||
        typeof stop !== 'object' ||
        Array.isArray(stop) ||
        typeof (stop as Record<string, unknown>).lat !== 'number' ||
        typeof (stop as Record<string, unknown>).lon !== 'number'
      ) {
        res.status(400).fail(
          'VALIDATION_ERROR',
          `stops[${i}] must be an object with numeric lat and lon`,
          400
        ); return
      }
    }

    // departureDate — required parseable date string
    if (typeof body.departureDate !== 'string') {
      res.status(400).fail('VALIDATION_ERROR', 'departureDate is required and must be a string', 400); return
    }

    const departure = new Date(body.departureDate as string)
    if (isNaN(departure.getTime())) {
      res.status(400).fail('VALIDATION_ERROR', 'departureDate must be a valid date string', 400); return
    }

    try {
      const prediction = await predictDelivery(
        req.orgId!,
        body.stops as Array<{ lat: number; lon: number }>,
        departure
      )
      res.ok({ prediction })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // POST /percentiles — compute percentiles from a numeric data set
  router.post('/percentiles', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // data — required non-empty number array
    if (!Array.isArray(body.data) || body.data.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'data is required and must be a non-empty array', 400); return
    }

    // Validate that every element is a number
    for (let i = 0; i < (body.data as unknown[]).length; i++) {
      if (typeof (body.data as unknown[])[i] !== 'number') {
        res.status(400).fail('VALIDATION_ERROR', `data[${i}] must be a number`, 400); return
      }
    }

    // Optional percentiles — if present must be a non-empty array of numbers
    if (body.percentiles !== undefined) {
      if (!Array.isArray(body.percentiles) || body.percentiles.length === 0) {
        res.status(400).fail('VALIDATION_ERROR', 'percentiles must be a non-empty array when provided', 400); return
      }
      for (let i = 0; i < (body.percentiles as unknown[]).length; i++) {
        if (typeof (body.percentiles as unknown[])[i] !== 'number') {
          res.status(400).fail('VALIDATION_ERROR', `percentiles[${i}] must be a number`, 400); return
        }
      }
    }

    try {
      const data = body.data as number[]

      if (body.percentiles !== undefined) {
        const ps = body.percentiles as number[]
        const histogram = buildHistogram(data)
        const result: Record<string, number> = {}
        for (const p of ps) {
          result[`p${p}`] = percentileFromHistogram(histogram, p)
        }
        res.ok({ result })
      } else {
        const result = computePercentiles(data)
        res.ok({ result })
      }
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // POST /decompose — time-series decomposition
  router.post('/decompose', async (req, res) => {
    const body = req.body as Record<string, unknown>

    // data — required non-empty array
    if (!Array.isArray(body.data) || body.data.length === 0) {
      res.status(400).fail('VALIDATION_ERROR', 'data is required and must be a non-empty array', 400); return
    }

    // periodLength — required integer >= 2
    if (typeof body.periodLength !== 'number' || body.periodLength < 2) {
      res.status(400).fail('VALIDATION_ERROR', 'periodLength is required and must be a number >= 2', 400); return
    }

    try {
      const decomposition = decompose(
        body.data as Array<{ timestamp: number; value: number }>,
        body.periodLength as number
      )
      res.ok({ decomposition })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /delivery-stats — historical route duration percentiles for the org
  router.get('/delivery-stats', async (req, res) => {
    const q = req.query as Record<string, string>

    // days — optional integer 1–90, default 30
    const rawDays = q.days ? parseInt(q.days, 10) : 30
    const days = isNaN(rawDays) || rawDays < 1 || rawDays > 90 ? 30 : rawDays

    try {
      const rows = await query<Record<string, unknown>>(
        `SELECT r.id, r.started_at, r.completed_at,
           EXTRACT(EPOCH FROM (r.completed_at - r.started_at))/60 as duration_minutes
         FROM routes r
         WHERE r.org_id = $1
           AND r.completed_at IS NOT NULL
           AND r.started_at >= NOW() - INTERVAL '1 day' * $2
         ORDER BY r.started_at DESC`,
        [req.orgId!, days]
      )

      const durations = rows
        .map((r) => Number(r.duration_minutes))
        .filter((d) => Number.isFinite(d))

      const count = durations.length

      if (count === 0) {
        res.ok({ stats: { count: 0, p50: null, p95: null, p99: null, days } })
        return
      }

      const { p50, p95, p99 } = computePercentiles(durations)
      res.ok({ stats: { count, p50, p95, p99, days } })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  return router
}
