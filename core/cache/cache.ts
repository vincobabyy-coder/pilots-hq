import Redis from 'ioredis'
import { logger } from '../logger/logger'

export class CacheError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'CacheError'
  }
}

const DEFAULT_TTL = 300
const MAX_TTL = 86400
const PREFIX = 'pilots:cache'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
    redis.on('error', (err) =>
      logger.warn('Cache Redis error', { error: err.message })
    )
  }
  return redis
}

function buildKey(namespace: string, key: string): string {
  // Strip any characters that could be used for key injection (\n, spaces, *)
  const safeNs = namespace.replace(/[\s\n\r*?[\]{}\\]/g, '_')
  const safeKey = key.replace(/[\s\n\r*?[\]{}\\]/g, '_')
  return `${PREFIX}:${safeNs}:${safeKey}`
}

export interface CacheOptions {
  ttl?: number       // seconds, default 300, max 86400
  namespace?: string // default 'global'
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedis()
    const pong = await r.ping()
    return pong === 'PONG'
  } catch {
    return false
  }
}

export const cache = {
  async get<T>(key: string, opts?: Pick<CacheOptions, 'namespace'>): Promise<T | null> {
    const r = getRedis()
    const rk = buildKey(opts?.namespace ?? 'global', key)
    try {
      const raw = await r.get(rk)
      if (raw === null) return null
      return JSON.parse(raw) as T
    } catch (err) {
      logger.warn('Cache get error', { key: rk, error: (err as Error).message })
      return null
    }
  },

  async set<T>(key: string, value: T, opts?: CacheOptions): Promise<void> {
    const r = getRedis()
    const rk = buildKey(opts?.namespace ?? 'global', key)
    const ttl = Math.min(opts?.ttl ?? DEFAULT_TTL, MAX_TTL)
    let serialized: string
    try {
      serialized = JSON.stringify(value)
    } catch (err) {
      throw new CacheError(`Failed to serialize cache value for key "${key}"`, err)
    }
    await r.set(rk, serialized, 'EX', ttl)
  },

  async del(key: string, opts?: Pick<CacheOptions, 'namespace'>): Promise<void> {
    const r = getRedis()
    const rk = buildKey(opts?.namespace ?? 'global', key)
    await r.del(rk)
  },

  async invalidatePattern(pattern: string, namespace?: string): Promise<number> {
    const r = getRedis()
    const ns = namespace ?? 'global'
    // Build the scan pattern — sanitize user-supplied pattern, then append glob
    const safePattern = pattern.replace(/[\n\r]/g, '')
    const scanPattern = `${PREFIX}:${ns}:${safePattern}`
    let cursor = '0'
    let deleted = 0
    do {
      const [nextCursor, keys] = await r.scan(cursor, 'MATCH', scanPattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await r.del(...keys)
        deleted += keys.length
      }
    } while (cursor !== '0')
    return deleted
  },
}
