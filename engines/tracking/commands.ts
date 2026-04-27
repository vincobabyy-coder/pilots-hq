import { appendEvent } from './event-log'
import { TrackingEvent, TrackingEventType } from './types'
import Redis from 'ioredis'
import { logger } from '../../core/logger/logger'

// Lazy Redis singleton for cache invalidation
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
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      })
    }
    redis.on('error', (err) => {
      logger.warn('Tracking commands Redis unavailable — cache invalidation skipped', { error: err.message })
    })
  }
  return redis
}

// Cache key for a shipment's materialized state
export const cacheKey = (shipmentId: string) => `shipment:state:${shipmentId}`

/**
 * Append an event and invalidate the Redis cache for this shipment.
 * Returns the appended event.
 * Does NOT handle WebSocket publishing (that's done by the API layer
 * which has access to the WsServer instance).
 */
export async function recordEvent(
  shipmentId: string,
  eventType: TrackingEventType,
  payload?: {
    eventStatus?: string
    lat?: number
    lon?: number
    details?: Record<string, unknown>
  }
): Promise<TrackingEvent> {
  const event = await appendEvent(shipmentId, eventType, payload)

  try {
    await getRedis().del(cacheKey(shipmentId))
  } catch (err) {
    logger.warn('Failed to invalidate shipment state cache', {
      shipmentId,
      error: (err as Error).message,
    })
  }

  return event
}
