import Redis from 'ioredis'
import { getFullJob, requeueJob, moveToDlq, FullJob, JobHandler, JobPriority } from './queue'
import { logger } from '../logger/logger'

export interface WorkerOptions {
  concurrency?: number     // default: 1, clamped 1–20
  pollIntervalMs?: number  // default: 500
}

const MAX_CONCURRENCY = 20

function queueListKey(queueName: string, priority: JobPriority): string {
  return `pilots:queue:${queueName}:${priority}`
}
function jobHashKey(jobId: string): string {
  return `pilots:job:${jobId}`
}

let workerRedis: Redis | null = null
function getWorkerRedis(): Redis {
  if (!workerRedis) {
    workerRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    workerRedis.on('error', (err) =>
      logger.warn('Worker Redis error', { error: err.message })
    )
  }
  return workerRedis
}

async function updateJobStatus(
  r: Redis,
  job: FullJob,
  status: FullJob['status'],
  extra: Partial<Pick<FullJob, 'result' | 'error'>> = {}
): Promise<void> {
  const now = new Date().toISOString()
  await r.hset(jobHashKey(job.id), {
    status,
    updatedAt: now,
    ...(extra.result !== undefined ? { result: JSON.stringify(extra.result) } : {}),
    ...(extra.error !== undefined ? { error: extra.error } : {}),
  })
}

function jobTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`JOB_TIMEOUT: exceeded ${ms}ms`)), ms)
  )
}

export function startFullWorker<T>(
  queueName: string,
  handler: JobHandler<T>,
  opts?: WorkerOptions
): { stop(): Promise<void> } {
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 1, MAX_CONCURRENCY))
  const pollIntervalMs = opts?.pollIntervalMs ?? 500
  let running = true
  let activeCount = 0
  let drainResolve: (() => void) | null = null

  async function processJob(jobId: string): Promise<void> {
    const r = getWorkerRedis()
    const jobData = await getFullJob(jobId)
    if (!jobData) {
      logger.warn('Worker: unknown job ID', { jobId, queue: queueName })
      return
    }
    const job = jobData as FullJob<T>

    await updateJobStatus(r, job, 'running')
    logger.info('Job started', { jobId: job.id, queue: queueName, attempt: job.attempts + 1 })

    try {
      const result = await Promise.race([
        handler(job),
        jobTimeout(job.timeoutMs),
      ])
      await updateJobStatus(r, job, 'done', { result })
      logger.info('Job completed', { jobId: job.id, queue: queueName })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const nextAttempt = job.attempts + 1
      if (nextAttempt <= job.maxRetries) {
        const delayMs = 1000 * Math.pow(2, job.attempts)  // exponential backoff
        logger.warn('Job failed, will retry', { jobId: job.id, attempt: nextAttempt, delayMs, error: message })
        await updateJobStatus(r, job, 'pending', { error: message })
        await requeueJob(job.id, queueName, delayMs)
      } else {
        await updateJobStatus(r, job, 'failed', { error: message })
        await moveToDlq(job.id, queueName)
        logger.warn('Job failed permanently, moved to DLQ', { jobId: job.id, queue: queueName, error: message })
      }
    }
  }

  async function tryDequeue(): Promise<string | null> {
    const r = getWorkerRedis()
    // Priority order: high → normal → low, 0.1s timeout per attempt
    for (const priority of ['high', 'normal', 'low'] as JobPriority[]) {
      const result = await r.blpop(queueListKey(queueName, priority), 0.1) as [string, string] | null
      if (result) return result[1]
    }
    return null
  }

  async function loop(): Promise<void> {
    logger.info('Full worker started', { queue: queueName, concurrency })
    while (running || activeCount > 0) {
      if (!running && activeCount === 0) break

      if (activeCount < concurrency && running) {
        let jobId: string | null = null
        try {
          jobId = await tryDequeue()
        } catch (err) {
          logger.warn('Worker dequeue error', { error: (err as Error).message })
          await new Promise(r => setTimeout(r, pollIntervalMs))
          continue
        }

        if (jobId) {
          activeCount++
          processJob(jobId)
            .catch(err => logger.error('Unhandled job error', { error: (err as Error).message }))
            .finally(() => {
              activeCount--
              if (!running && activeCount === 0 && drainResolve) drainResolve()
            })
        } else {
          await new Promise(r => setTimeout(r, pollIntervalMs))
        }
      } else {
        await new Promise(r => setTimeout(r, pollIntervalMs))
      }
    }
    logger.info('Full worker stopped', { queue: queueName })
  }

  loop().catch(err =>
    logger.error('Worker loop crashed', { queue: queueName, error: (err as Error).message })
  )

  return {
    stop(): Promise<void> {
      running = false
      if (activeCount === 0) return Promise.resolve()
      return new Promise(resolve => { drainResolve = resolve })
    },
  }
}
