import Redis from 'ioredis'
import { randomUUID } from 'crypto'
import { logger } from '../logger/logger'

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobPriority = 'high' | 'normal' | 'low'
export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'scheduled'

export interface JobOptions {
  priority?: JobPriority   // default: 'normal'
  maxRetries?: number      // default: 3, clamped to 10
  timeoutMs?: number       // default: 30_000, range 1000–300_000
}

export interface JobAttemptRecord {
  attemptNumber: number    // 1-based
  startedAt:     string   // ISO-8601
  completedAt:   string   // ISO-8601
  result:        'success' | 'failure' | 'timeout'
  errorMessage?: string
  durationMs:    number
}

export interface FullJob<T = unknown> {
  id: string
  queue: string
  payload: T
  inputSnapshot: unknown   // original payload at enqueue time (immutable copy)
  status: JobStatus
  priority: JobPriority
  attempts: number         // how many times this job has been attempted
  maxRetries: number
  timeoutMs: number
  result?: unknown
  error?: string
  executionTrace: JobAttemptRecord[]  // appended after each attempt
  createdAt: string
  updatedAt: string
}

export type JobHandler<T = unknown> = (job: FullJob<T>) => Promise<unknown>

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES_CAP = 10
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 300_000
const DLQ_MAX_SIZE = 1_000
const JOB_TTL_SECONDS = 86_400  // 24h

// ── Redis singleton ────────────────────────────────────────────────────────────

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    redis.on('error', (err) =>
      logger.warn('Queue Redis error', { error: err.message })
    )
  }
  return redis
}

// ── Key builders ──────────────────────────────────────────────────────────────

function listKey(queueName: string, priority: JobPriority): string {
  return `pilots:queue:${queueName}:${priority}`
}
function jobKey(jobId: string): string {
  return `pilots:job:${jobId}`
}
function dlqKey(queueName: string): string {
  return `pilots:dlq:${queueName}`
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function saveFullJob(r: Redis, job: FullJob): Promise<void> {
  const key = jobKey(job.id)
  await r
    .multi()
    .hset(key, {
      id: job.id,
      queue: job.queue,
      payload: JSON.stringify(job.payload),
      inputSnapshot: JSON.stringify(job.inputSnapshot),
      status: job.status,
      priority: job.priority,
      attempts: String(job.attempts),
      maxRetries: String(job.maxRetries),
      timeoutMs: String(job.timeoutMs),
      result: job.result !== undefined ? JSON.stringify(job.result) : '',
      error: job.error ?? '',
      executionTrace: JSON.stringify(job.executionTrace),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })
    .expire(key, JOB_TTL_SECONDS)
    .exec()
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueueFull<T>(
  queueName: string,
  payload: T,
  opts?: JobOptions
): Promise<string> {
  const r = getRedis()
  const id = randomUUID()
  const now = new Date().toISOString()
  const priority: JobPriority = opts?.priority ?? 'normal'
  const maxRetries = Math.min(opts?.maxRetries ?? 3, MAX_RETRIES_CAP)
  const timeoutMs = Math.max(
    MIN_TIMEOUT_MS,
    Math.min(opts?.timeoutMs ?? 30_000, MAX_TIMEOUT_MS)
  )

  let serialized: string
  try {
    serialized = JSON.stringify(payload)
    JSON.parse(serialized)  // verify round-trip
  } catch {
    throw new Error(`Job payload for queue "${queueName}" is not JSON-serializable`)
  }

  const job: FullJob<T> = {
    id, queue: queueName, payload,
    inputSnapshot: JSON.parse(serialized) as unknown,  // deep-copy of payload at enqueue time
    status: 'pending',
    priority, attempts: 0, maxRetries, timeoutMs,
    executionTrace: [],
    createdAt: now, updatedAt: now,
  }

  await saveFullJob(r, job as FullJob)
  await r.rpush(listKey(queueName, priority), id)
  logger.info('Job enqueued', { jobId: id, queue: queueName, priority })
  return id
}

export async function getFullJob(jobId: string): Promise<FullJob | null> {
  const r = getRedis()
  const raw = await r.hgetall(jobKey(jobId))
  if (!raw || Object.keys(raw).length === 0) return null

  const job: FullJob = {
    id: raw['id'] ?? jobId,
    queue: raw['queue'] ?? '',
    payload: raw['payload'] ? JSON.parse(raw['payload']) : null,
    inputSnapshot: raw['inputSnapshot'] ? JSON.parse(raw['inputSnapshot']) : null,
    status: (raw['status'] ?? 'pending') as JobStatus,
    priority: (raw['priority'] ?? 'normal') as JobPriority,
    attempts: parseInt(raw['attempts'] ?? '0', 10),
    maxRetries: parseInt(raw['maxRetries'] ?? '3', 10),
    timeoutMs: parseInt(raw['timeoutMs'] ?? '30000', 10),
    executionTrace: raw['executionTrace'] ? (JSON.parse(raw['executionTrace']) as JobAttemptRecord[]) : [],
    createdAt: raw['createdAt'] ?? '',
    updatedAt: raw['updatedAt'] ?? '',
  }
  if (raw['result']) job.result = JSON.parse(raw['result'])
  if (raw['error']) job.error = raw['error']
  return job
}

export async function requeueJob(jobId: string, queueName: string, delayMs: number): Promise<void> {
  const r = getRedis()
  const job = await getFullJob(jobId)
  if (!job) return

  job.attempts += 1
  job.status = 'pending'
  job.updatedAt = new Date().toISOString()
  await saveFullJob(r, job)

  // Push back onto queue after delay using setTimeout
  setTimeout(async () => {
    try {
      await r.rpush(listKey(queueName, job.priority), jobId)
      logger.info('Job requeued after backoff', { jobId, queue: queueName, attempt: job.attempts, delayMs })
    } catch (err) {
      logger.error('Failed to requeue job', { jobId, error: (err as Error).message })
    }
  }, delayMs)
}

export async function moveToDlq(jobId: string, queueName: string): Promise<void> {
  const r = getRedis()
  const key = dlqKey(queueName)
  await r
    .multi()
    .rpush(key, jobId)
    .ltrim(key, -DLQ_MAX_SIZE, -1)  // keep only last 1000
    .exec()
  logger.warn('Job moved to DLQ', { jobId, queue: queueName })
}

export async function getDlqJobs(queueName: string, limit = 50): Promise<FullJob[]> {
  const r = getRedis()
  const ids = await r.lrange(dlqKey(queueName), -limit, -1)
  const jobs = await Promise.all(ids.map(id => getFullJob(id)))
  return jobs.filter((j): j is FullJob => j !== null)
}

// Takes a job from the DLQ, resets attempts to 0, clears executionTrace,
// and re-enqueues it in the normal priority queue.
// Returns the NEW job ID (same payload, fresh state).
export async function replayDlqJob(jobId: string, queueName: string): Promise<string> {
  const r = getRedis()
  const original = await getFullJob(jobId)
  if (!original) {
    throw new Error(`Job "${jobId}" not found — cannot replay`)
  }

  const now = new Date().toISOString()
  const newId = randomUUID()

  // Build a fresh job from the original's inputSnapshot so the payload is
  // exactly what was submitted at enqueue time (not a potentially mutated value).
  const freshJob: FullJob = {
    ...original,
    id: newId,
    status: 'pending',
    attempts: 0,
    executionTrace: [],
    result: undefined,
    error: undefined,
    createdAt: now,
    updatedAt: now,
    // Restore payload from the immutable snapshot
    payload: original.inputSnapshot,
  }

  await saveFullJob(r, freshJob)
  await r.rpush(listKey(queueName, freshJob.priority), newId)
  logger.info('DLQ job replayed', { originalJobId: jobId, newJobId: newId, queue: queueName })
  return newId
}

// Returns the executionTrace for a job, or an empty array if not found.
export async function getJobTrace(jobId: string): Promise<JobAttemptRecord[]> {
  const job = await getFullJob(jobId)
  return job?.executionTrace ?? []
}
