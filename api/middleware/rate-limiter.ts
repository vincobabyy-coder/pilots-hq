import { Middleware } from '../../core/http/types'
import { logger } from '../../core/logger/logger'
import Redis from 'ioredis'
import { randomBytes } from 'crypto'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS
    if (sentinelHosts) {
      const sentinels = sentinelHosts.split(',').map(hp => {
        const [host, port] = hp.trim().split(':')
        const parsedPort = parseInt(port ?? '26379', 10)
        return { host, port: isNaN(parsedPort) ? 26379 : parsedPort }
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

// Per-tier rate limit configurations. Routes not listed fall through to 'default'.
const TIER_LIMITS: Record<string, Record<string, RateLimitConfig>> = {
  starter: {
    'POST /api/v1/auth/login': { windowMs: 60_000, maxRequests: 5 },
    'POST /api/v1/orders':     { windowMs: 60_000, maxRequests: 10 },
    'default':                  { windowMs: 60_000, maxRequests: 30 },
  },
  growth: {
    'POST /api/v1/auth/login': { windowMs: 60_000, maxRequests: 10 },
    'POST /api/v1/orders':     { windowMs: 60_000, maxRequests: 60 },
    'default':                  { windowMs: 60_000, maxRequests: 120 },
  },
  enterprise: {
    'POST /api/v1/auth/login': { windowMs: 60_000, maxRequests: 20 },
    'POST /api/v1/orders':     { windowMs: 60_000, maxRequests: 300 },
    'default':                  { windowMs: 60_000, maxRequests: 600 },
  },
}

/**
 * Decode the `tier` claim from a JWT Authorization header without re-verifying
 * the signature. Auth middleware upstream has already verified the token; we only
 * need the tier value here. Returns null if the header is absent or malformed.
 */
function extractTierFromAuthHeader(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    // Restore standard base64 padding before decoding
    const bodyPart = parts[1]
    const padded = bodyPart + '==='.slice((bodyPart.length + 3) % 4)
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const payload = JSON.parse(decoded) as Record<string, unknown>
    const tier = payload['tier']
    return typeof tier === 'string' ? tier : null
  } catch {
    return null
  }
}

export function rateLimiter(config?: RateLimitConfig): Middleware {
  return async (req, res, next) => {
    const rawForwardedFor = req.headers['x-forwarded-for']
    const clientIp = Array.isArray(rawForwardedFor)
      ? rawForwardedFor[0].split(',')[0].trim()
      : rawForwardedFor?.split(',')[0].trim()

    // Determine the effective rate limit.
    // When config is explicitly passed (e.g. in tests or route-specific overrides), use it
    // directly and skip tier logic so that callers remain in full control.
    let limit: RateLimitConfig
    let keyPrefix = 'rl:'

    if (config !== undefined) {
      limit = config
    } else {
      const routeKey = `${req.method} ${req.path}`

      // Decode tier from the JWT carried in the Authorization header. Auth middleware
      // has already validated the token upstream; we only base64-decode the payload here.
      const tier = extractTierFromAuthHeader(req.headers['authorization']) ?? 'starter'
      const tierLimits = TIER_LIMITS[tier] ?? TIER_LIMITS['starter']
      const tierLimit = tierLimits[routeKey] ?? tierLimits['default']

      // Enterprise requests with X-Priority: high get their own Redis key bucket with
      // doubled capacity, keeping them isolated from standard traffic.
      const isHighPriority = req.headers['x-priority'] === 'high' && tier === 'enterprise'
      keyPrefix = isHighPriority ? 'rl:hp:' : 'rl:'
      limit = isHighPriority
        ? { ...tierLimit, maxRequests: tierLimit.maxRequests * 2 }
        : tierLimit
    }

    const key = `${keyPrefix}${clientIp ?? req.headers['host'] ?? 'unknown'}:${req.method}:${req.path}`

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

        // Track rate limit hits for security monitoring
        try {
          await r.incr('pilots:metrics:rate_limit_hits:1h')
          await r.expire('pilots:metrics:rate_limit_hits:1h', 3600)
        } catch {
          // Swallow errors; tracking is best-effort
        }

        res.setHeader('Retry-After', String(retryAfter))
        res.status(429).fail('RATE_LIMITED', 'Too many requests', 429)
        return
      }

      await r.multi()
        .zadd(key, now, `${now}-${randomBytes(8).toString('hex')}`)
        .pexpire(key, limit.windowMs)
        .exec()
    } catch {
      // Redis unavailable — fail open (allow request through, log once via the error handler above)
    }
    await next()
  }
}
