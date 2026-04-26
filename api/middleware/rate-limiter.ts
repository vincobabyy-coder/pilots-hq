import { Middleware } from '../../core/http/types'
import Redis from 'ioredis'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
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
    await next()
  }
}
