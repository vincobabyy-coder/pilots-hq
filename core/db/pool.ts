import { Pool, PoolClient, QueryResult } from 'pg'
import { logger } from '../logger/logger'
import {
  recordQuerySnapshot,
  normalizeQuery,
  fingerprintQuery,
  SLOW_THRESHOLD_MS,
} from './query-metrics'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (err) => {
      logger.error('PostgreSQL pool error', { error: (err as Error).message })
    })
  }
  return pool
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const start = Date.now()
  const result: QueryResult<T> = await getPool().query(sql, params)
  const executionMs = Date.now() - start

  const template = normalizeQuery(sql)
  const isSlow = executionMs > SLOW_THRESHOLD_MS

  // DDL statements (CREATE TABLE, CREATE INDEX) return result.rows = undefined
  const rows: T[] = result.rows ?? []

  recordQuerySnapshot({
    fingerprint: fingerprintQuery(template),
    template,
    executionMs,
    rowsReturned: rows.length,
    recordedAt: new Date(),
    isSlow,
  })

  if (isSlow) {
    logger.warn('Slow query detected', {
      executionMs,
      template,
      rowsReturned: rows.length,
    })
  }

  return rows
}

export async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function transaction<T>(
  fn: (client: { query: typeof query }) => Promise<T>
): Promise<T> {
  const client: PoolClient = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn({
      query: async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const r: QueryResult<R> = await client.query(sql, params)
        return r.rows
      }
    })
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

let replicaPool: Pool | null = null
let replicaFallbackWarned = false

function getReplicaPool(): Pool {
  if (!replicaPool) {
    const replicaUrl = process.env.POSTGRES_REPLICA_URL
    if (!replicaUrl && !replicaFallbackWarned) {
      logger.warn('POSTGRES_REPLICA_URL not set — queryReplica() will use primary pool')
      replicaFallbackWarned = true
    }
    replicaPool = new Pool({ connectionString: replicaUrl ?? process.env.DATABASE_URL })
    replicaPool.on('error', (err) => {
      logger.error('PostgreSQL replica pool error', { error: (err as Error).message })
    })
  }
  return replicaPool
}

export async function queryReplica<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getReplicaPool().query(sql, params)
  return result.rows as T[]
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null }
  if (replicaPool) { await replicaPool.end(); replicaPool = null }
}
