import { createHash } from 'crypto'

export interface QuerySnapshot {
  fingerprint: string    // SHA-256 of normalized template (first 16 hex chars)
  template: string       // query with $1/$2 (no actual values, for safety)
  executionMs: number
  rowsReturned: number
  recordedAt: Date
  isSlow: boolean        // executionMs > SLOW_THRESHOLD_MS
  explainPlan?: string
}

const SLOW_THRESHOLD_MS = 100
const MAX_SNAPSHOTS = 500  // ring buffer cap

// In-memory ring buffer — never grows beyond MAX_SNAPSHOTS entries
const snapshots: QuerySnapshot[] = []

export function recordQuerySnapshot(snapshot: QuerySnapshot): void {
  if (snapshots.length >= MAX_SNAPSHOTS) {
    snapshots.shift()
  }
  snapshots.push(snapshot)
}

export function getRecentSnapshots(limit = MAX_SNAPSHOTS): QuerySnapshot[] {
  return snapshots.slice(-limit)
}

export function getSlowQuerySummary(): {
  totalQueries: number
  slowQueries: number
  slowQueryRate: number
  topSlow: QuerySnapshot[]
  p50Ms: number
  p95Ms: number
  p99Ms: number
} {
  const total = snapshots.length

  if (total === 0) {
    return {
      totalQueries: 0,
      slowQueries: 0,
      slowQueryRate: 0,
      topSlow: [],
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    }
  }

  const slow = snapshots.filter((s) => s.isSlow)

  // top 10 slowest
  const topSlow = [...snapshots]
    .sort((a, b) => b.executionMs - a.executionMs)
    .slice(0, 10)

  // percentiles over all recorded execution times
  const sorted = [...snapshots].map((s) => s.executionMs).sort((a, b) => a - b)

  const percentile = (pct: number): number => {
    const idx = Math.ceil((pct / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]
  }

  return {
    totalQueries: total,
    slowQueries: slow.length,
    slowQueryRate: slow.length / total,
    topSlow,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    p99Ms: percentile(99),
  }
}

/**
 * Normalize a SQL string for fingerprinting:
 * - Lowercase keywords (structural words)
 * - Collapse runs of whitespace to a single space
 * - Trim leading/trailing whitespace
 *
 * Parameterized queries already use $1/$2 placeholders, so no literal
 * stripping is needed — the template is already safe.
 */
export function normalizeQuery(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /\b(SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|HAVING|JOIN|LEFT|RIGHT|INNER|OUTER|ON|INSERT|INTO|VALUES|UPDATE|SET|DELETE|LIMIT|OFFSET|RETURNING|BEGIN|COMMIT|ROLLBACK)\b/g,
      (kw) => kw.toLowerCase()
    )
}

/**
 * Return the first 16 hex characters of the SHA-256 of the normalized SQL.
 * This is enough entropy to identify distinct query shapes without storing
 * full hashes.
 */
export function fingerprintQuery(normalizedSql: string): string {
  return createHash('sha256').update(normalizedSql).digest('hex').slice(0, 16)
}

// Re-export threshold so pool.ts can reference the same constant
export { SLOW_THRESHOLD_MS }
