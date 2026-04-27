import { replayEvents } from './event-log'
import { reduceEvents } from './state-machine'
import { cacheKey } from './commands'
import { ShipmentState, TrackingEvent } from './types'
import Redis from 'ioredis'
import { logger } from '../../core/logger/logger'
import { query } from '../../core/db/pool'

// Lazy Redis singleton for cache reads/writes
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
      logger.warn('Tracking queries Redis unavailable — falling back to DB', { error: err.message })
    })
  }
  return redis
}

/**
 * Restore Date fields after JSON.parse (which yields ISO strings for Date values).
 */
function hydrateState(raw: Record<string, unknown>): ShipmentState {
  const partial = raw as unknown as ShipmentState
  return {
    ...partial,
    lastUpdatedAt: new Date(raw.lastUpdatedAt as string),
    deliveredAt: raw.deliveredAt != null ? new Date(raw.deliveredAt as string) : undefined,
  }
}

/**
 * Get the current state of a shipment.
 * Checks Redis cache first. On miss: replay events + reduce + cache result (TTL 60s).
 */
export async function getCurrentState(shipmentId: string): Promise<ShipmentState | null> {
  // 1. Try Redis cache
  try {
    const cached = await getRedis().get(cacheKey(shipmentId))
    if (cached != null) {
      return hydrateState(JSON.parse(cached) as Record<string, unknown>)
    }
  } catch (err) {
    logger.warn('Redis get failed for shipment state — falling through to DB', {
      shipmentId,
      error: (err as Error).message,
    })
  }

  // 2. Cache miss — replay from DB
  const events = await replayEvents(shipmentId)
  if (events.length === 0) return null

  const state = reduceEvents(shipmentId, events)

  // 3. Populate cache (TTL 60s), fail-open
  try {
    await getRedis().setex(cacheKey(shipmentId), 60, JSON.stringify(state))
  } catch (err) {
    logger.warn('Redis setex failed for shipment state — continuing without cache', {
      shipmentId,
      error: (err as Error).message,
    })
  }

  return state
}

/**
 * Get all events for a shipment (raw event log).
 */
export async function getEventLog(shipmentId: string): Promise<TrackingEvent[]> {
  return replayEvents(shipmentId)
}

interface LateShipmentRow extends Record<string, unknown> {
  shipment_id: string
}

/**
 * Find all shipments that are potentially late.
 * Queries tracking_events for shipments with last event > 2 hours ago
 * where last status is not 'delivered' or 'cancelled'.
 */
export async function findLateShipments(orgId: string): Promise<string[]> {
  const rows = await query<LateShipmentRow>(
    `SELECT DISTINCT shipment_id
     FROM tracking_events
     WHERE shipment_id IN (
       SELECT id FROM shipments WHERE org_id = $1
     )
     GROUP BY shipment_id
     HAVING MAX(created_at) < NOW() - INTERVAL '2 hours'
       AND (array_agg(event_type ORDER BY created_at DESC))[1] NOT IN ('delivered', 'cancelled')`,
    [orgId]
  )
  return rows.map(r => r.shipment_id)
}
