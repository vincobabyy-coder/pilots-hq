import { Router } from '../../core/http/router'
import { getPool } from '../../core/db/pool'
import { pingRedis } from '../../core/cache/cache'
import { getSlowQuerySummary } from '../../core/db/query-metrics'

export function healthRouter(): Router {
  const router = new Router()

  router.get('/', async (_req, res) => {
    const checks = await Promise.allSettled([
      getPool().query('SELECT 1'),
      pingRedis(),
    ])

    const db = checks[0].status === 'fulfilled'
    const redis = checks[1].status === 'fulfilled' && checks[1].value === true

    const status = db && redis ? 'ok' : 'degraded'
    const httpStatus = status === 'ok' ? 200 : 503

    const queryMetrics = getSlowQuerySummary()

    res.status(httpStatus).ok({
      status,
      version: process.env.npm_package_version ?? '0.1.0',
      uptime: Math.floor(process.uptime()),
      checks: {
        database: db ? 'ok' : 'error',
        redis: redis ? 'ok' : 'error',
      },
      performance: {
        queries: {
          total: queryMetrics.totalQueries,
          slowCount: queryMetrics.slowQueries,
          slowRate: queryMetrics.slowQueryRate,
          p50Ms: queryMetrics.p50Ms,
          p95Ms: queryMetrics.p95Ms,
          p99Ms: queryMetrics.p99Ms,
        },
      },
    })
  })

  return router
}
