import { Middleware } from '../../core/http/types'
import { logger } from '../../core/logger/logger'
import Redis from 'ioredis'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS
    if (sentinelHosts) {
      const sentinels = sentinelHosts.split(',').map(hp => {
        const [host, port] = hp.trim().split(':')
        return { host, port: parseInt(port ?? '26379', 10) }
      })
      redis = new Redis({
        sentinels,
        name: process.env.REDIS_SENTINEL_NAME ?? 'mymaster',
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      })
    } else {
      redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        // Fail fast instead of queuing retries indefinitely
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      })
    }
    redis.on('error', (err) => {
      logger.warn('Rate limiter Redis unavailable — requests will pass through', { error: err.message })
    })
  }
  return redis
}

interface RateLimitConfig {
  windowMs: number      // time window in milliseconds
  maxRequests: number   // max requests per window
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  'POST /api/v1/auth/login': { windowMs: 60_000, maxRequests: 10 },
  'default': { windowMs: 60_000, maxRequests: 100 },
}

export function rateLimiter(config?: RateLimitConfig): Middleware {
  return async (req, res, next) => {
    const key = `rl:${req.headers['x-forwarded-for'] ?? req.headers['host'] ?? 'unknown'}:${req.method}:${req.path}`
    const limit = config ?? DEFAULT_LIMITS[`${req.method} ${req.path}`] ?? DEFAULT_LIMITS['default']

    try {
      const r = getRedis()
      const now = Date.now()
      const windowStart = now - limit.windowMs

      // Sliding window using Redis sorted set
      await r.zremrangebyscore(key, '-inf', windowStart)
      const count = await r.zcard(key)

      if (count >= limit.maxRequests) {
        const oldest = await r.zrange(key, 0, 0, 'WITHSCORES')
        const retryAfter = oldest.length >= 2
          ? Math.ceil((parseInt(oldest[1]) + limit.windowMs - now) / 1000)
          : Math.ceil(limit.windowMs / 1000)
        res.setHeader('Retry-After', String(retryAfter))
        res.status(429).fail('RATE_LIMITED', 'Too many requests', 429)
        return
      }

      await r.zadd(key, now, `${now}-${Math.random()}`)
      await r.pexpire(key, limit.windowMs)
    } catch {
      // Redis unavailable — fail open (allow request through, log once via the error handler above)
    }
    await next()
  }
}
