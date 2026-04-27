import Redis from 'ioredis'
import { enqueueFull, JobOptions } from './queue'
import { logger } from '../logger/logger'

const SCHEDULER_KEY = 'pilots:scheduler:jobs'
const LOCK_KEY = 'pilots:scheduler:lock'
const LOCK_TTL_SECONDS = 10
const TICK_INTERVAL_MS = 5_000
const MIN_INTERVAL_MS = 10_000
const NAME_REGEX = /^[a-zA-Z0-9\-_.]{1,128}$/

export interface ScheduledJob {
  name: string           // unique identifier — alphanumeric + dashes/dots, max 128 chars
  queueName: string
  payload: unknown
  intervalMs: number     // how often to repeat, minimum 10_000ms
  jobOpts?: JobOptions
}

interface ScheduledJobRecord {
  name: string
  queueName: string
  payload: unknown
  intervalMs: number
  jobOpts?: JobOptions
}

let schedulerRedis: Redis | null = null
function getSchedulerRedis(): Redis {
  if (!schedulerRedis) {
    schedulerRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    schedulerRedis.on('error', (err) =>
      logger.warn('Scheduler Redis error', { error: err.message })
    )
  }
  return schedulerRedis
}

export async function scheduleJob(job: ScheduledJob): Promise<void> {
  if (!NAME_REGEX.test(job.name)) {
    throw new Error(`Invalid scheduled job name "${job.name}". Use alphanumeric, dashes, dots only (max 128 chars).`)
  }
  const intervalMs = Math.max(job.intervalMs, MIN_INTERVAL_MS)
  const r = getSchedulerRedis()
  const record: ScheduledJobRecord = {
    name: job.name,
    queueName: job.queueName,
    payload: job.payload,
    intervalMs,
    jobOpts: job.jobOpts,
  }
  const nextRun = Date.now() + intervalMs
  await r.zadd(SCHEDULER_KEY, String(nextRun), JSON.stringify(record))
  logger.info('Scheduled job registered', { name: job.name, intervalMs, nextRunAt: new Date(nextRun).toISOString() })
}

export async function cancelScheduledJob(name: string): Promise<void> {
  const r = getSchedulerRedis()
  // Must scan all members to find by name (sorted set has score+member)
  const all = await r.zrange(SCHEDULER_KEY, 0, -1)
  for (const member of all) {
    try {
      const record = JSON.parse(member) as ScheduledJobRecord
      if (record.name === name) {
        await r.zrem(SCHEDULER_KEY, member)
        logger.info('Scheduled job cancelled', { name })
        return
      }
    } catch { /* malformed entry, skip */ }
  }
}

async function tick(): Promise<void> {
  const r = getSchedulerRedis()
  // Distributed lock — only one instance runs the scheduler
  const acquired = await r.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  if (!acquired) return  // another instance holds the lock

  try {
    const now = Date.now()
    // Get all jobs due (score <= now)
    const due = await r.zrangebyscore(SCHEDULER_KEY, '-inf', String(now), 'WITHSCORES')
    // Result is interleaved [member, score, member, score, ...]
    for (let i = 0; i < due.length; i += 2) {
      const member = due[i]
      if (!member) continue
      let record: ScheduledJobRecord
      try {
        record = JSON.parse(member) as ScheduledJobRecord
      } catch {
        await r.zrem(SCHEDULER_KEY, member)
        continue
      }

      // Remove old entry and add rescheduled entry
      const nextRun = now + Math.max(record.intervalMs, MIN_INTERVAL_MS)
      const updated: ScheduledJobRecord = { ...record, intervalMs: record.intervalMs }

      await r
        .multi()
        .zrem(SCHEDULER_KEY, member)
        .zadd(SCHEDULER_KEY, String(nextRun), JSON.stringify(updated))
        .exec()

      // Enqueue the job
      try {
        await enqueueFull(record.queueName, record.payload, record.jobOpts)
        logger.info('Scheduled job fired', { name: record.name, queue: record.queueName })
      } catch (err) {
        logger.error('Failed to fire scheduled job', { name: record.name, error: (err as Error).message })
      }
    }
  } finally {
    await r.del(LOCK_KEY)
  }
}

export function startScheduler(): { stop(): void } {
  let running = true
  let timer: NodeJS.Timeout | null = null

  async function loop(): Promise<void> {
    if (!running) return
    try {
      await tick()
    } catch (err) {
      logger.error('Scheduler tick error', { error: (err as Error).message })
    }
    if (running) {
      timer = setTimeout(() => { loop().catch(() => {}) }, TICK_INTERVAL_MS)
    }
  }

  loop().catch(() => {})
  logger.info('Scheduler started', { tickIntervalMs: TICK_INTERVAL_MS })

  return {
    stop(): void {
      running = false
      if (timer) clearTimeout(timer)
      logger.info('Scheduler stopped')
    },
  }
}
