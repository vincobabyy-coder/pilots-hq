import { Pool, PoolClient, QueryResult } from 'pg'

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
      process.stderr.write(JSON.stringify({ level: 'error', msg: 'pg pool error', err: err.message }) + '\n')
    })
  }
  return pool
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result: QueryResult<T> = await getPool().query(sql, params)
  return result.rows
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

function getReplicaPool(): Pool {
  if (!replicaPool) {
    const replicaUrl = process.env.POSTGRES_REPLICA_URL
    // Falls back to primary if replica not configured
    replicaPool = new Pool({ connectionString: replicaUrl ?? process.env.DATABASE_URL })
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
