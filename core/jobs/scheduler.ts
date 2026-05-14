import { logger } from '../logger/logger'
import Redis from 'ioredis'
import { randomBytes } from 'crypto'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    redis.on('error', (err) => {
      logger.warn('Job scheduler Redis unavailable', { error: err.message })
    })
  }
  return redis
}

export interface JobConfig {
  id: string
  name: string
  schedule: string // cron-like: "0 2 * * *" = daily at 2 AM
  handler: () => Promise<void>
  maxDurationMs: number
  retryOnFailure: boolean
}

class JobScheduler {
  private jobs: Map<string, JobConfig> = new Map()
  private intervals: Map<string, NodeJS.Timeout> = new Map()

  register(config: JobConfig): void {
    this.jobs.set(config.id, config)
  }

  async start(): Promise<void> {
    for (const [jobId, config] of this.jobs) {
      // For MVP: use simple setInterval based on schedule
      // Production: use node-cron or bull for sophisticated scheduling
      const interval = this.parseScheduleToMs(config.schedule)
      if (interval > 0) {
        const timer = setInterval(() => this.executeJob(config), interval)
        this.intervals.set(jobId, timer)
        logger.info('Job scheduled', { jobId: config.name, intervalMs: interval })
      }
    }
  }

  private parseScheduleToMs(schedule: string): number {
    // Simple parser: support "every X minutes", "daily", "weekly", "monthly"
    if (schedule.includes('minute')) {
      const minutes = parseInt(schedule.match(/\d+/)?.[0] ?? '1')
      return minutes * 60 * 1000
    }
    if (schedule === 'daily') return 24 * 60 * 60 * 1000
    if (schedule === 'weekly') return 7 * 24 * 60 * 60 * 1000
    if (schedule === 'monthly') return 30 * 24 * 60 * 60 * 1000
    return 0
  }

  private async executeJob(config: JobConfig): Promise<void> {
    const lockKey = `job:lock:${config.id}`
    const lockValue = randomBytes(16).toString('hex')
    const lockTTL = Math.ceil(config.maxDurationMs / 1000) + 10 // TTL = max duration + buffer

    try {
      const r = getRedis()

      // Acquire distributed lock to prevent concurrent execution across instances
      const lockAcquired = await r.set(lockKey, lockValue, 'EX', lockTTL, 'NX')
      if (!lockAcquired) {
        logger.debug('Job already running on another instance', { jobId: config.id })
        return
      }

      const startTime = Date.now()
      logger.info('Job started', { jobId: config.id })

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Job timeout')), config.maxDurationMs)
      )
      await Promise.race([config.handler(), timeoutPromise])

      const duration = Date.now() - startTime
      logger.info('Job completed', { jobId: config.id, durationMs: duration })
    } catch (error) {
      logger.error('Job failed', {
        jobId: config.id,
        error: (error as Error).message,
      })

      if (config.retryOnFailure) {
        const retryKey = `job:retry:${config.id}`
        try {
          await getRedis().incr(retryKey)
          await getRedis().expire(retryKey, 24 * 60 * 60) // Keep retry count for 24 hours
        } catch {
          // Swallow; retry tracking is best-effort
        }
      }
    } finally {
      // Release lock
      try {
        const r = getRedis()
        const currentValue = await r.get(lockKey)
        if (currentValue === lockValue) {
          await r.del(lockKey)
        }
      } catch {
        // Swallow; lock cleanup is best-effort
      }
    }
  }

  stop(): void {
    for (const timer of this.intervals.values()) {
      clearInterval(timer)
    }
    this.intervals.clear()
  }
}

export const scheduler = new JobScheduler()
