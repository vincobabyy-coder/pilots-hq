import { Router } from '../../core/http/router'
import { getPool } from '../../core/db/pool'
import { pingRedis } from '../../core/cache/cache'
import { getSlowQuerySummary } from '../../core/db/query-metrics'
import Redis from 'ioredis'
import { logger } from '../../core/logger/logger'

let metricsRedis: Redis | null = null

function getMetricsRedis(): Redis {
  if (!metricsRedis) {
    metricsRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
    metricsRedis.on('error', (err) =>
      logger.warn('Security metrics Redis error', { error: err.message })
    )
  }
  return metricsRedis
}

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

  router.get('/security', async (_req, res) => {
    try {
      const r = getMetricsRedis()

      const failedLoginsLastHour = parseInt(await r.get('pilots:metrics:failed_logins:1h') || '0', 10)
      const rateLimitHitsLastHour = parseInt(await r.get('pilots:metrics:rate_limit_hits:1h') || '0', 10)

      // Count locked accounts by scanning login_attempts:* keys
      let lockedAccountCount = 0
      try {
        const keys = await r.keys('login_attempts:*')
        // Each key with a count >= 5 represents a locked account
        for (const key of keys) {
          const count = parseInt(await r.get(key) || '0', 10)
          if (count >= 5) lockedAccountCount++
        }
      } catch {
        // Scanning may fail; treat as 0
      }

      res.ok({
        securityEvents: {
          failedLoginsLastHour,
          rateLimitHitsLastHour,
          lockedAccountCount,
        },
      })
    } catch (err) {
      logger.error('Security health check failed', { error: (err as Error).message })
      res.status(500).fail('HEALTH_CHECK_FAILED', 'Security health check failed', 500)
    }
  })

  return router
}
