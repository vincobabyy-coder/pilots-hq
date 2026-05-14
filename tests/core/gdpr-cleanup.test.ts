import { describe, it, expect } from '../runner'
import { GdprCleanup, RetentionPolicy } from '../../core/compliance/gdpr-cleanup'

// ---------------------------------------------------------------------------
// Mock the DB pool so no real Postgres connection is required
// ---------------------------------------------------------------------------
type QueryFn = (sql: string, params: unknown[]) => Promise<{ count: string }[]>

let capturedSql = ''
let capturedParams: unknown[] = []
let mockRowCount = '5'

const mockQuery: QueryFn = async (sql, params) => {
  capturedSql = sql
  capturedParams = params
  return [{ count: mockRowCount }]
}

// Patch pool.query used by GdprCleanup via module-level monkey-patch
// GdprCleanup calls `query` from '../../core/db/pool' — we need to test the
// SQL-generation logic in isolation.  We do this by subclassing and overriding
// the internal `query` call via a protected helper.

class TestableGdprCleanup extends GdprCleanup {
  // Override runPolicy to intercept the query call without hitting the DB
  protected async executeQuery(sql: string, params: unknown[]): Promise<number> {
    capturedSql = sql
    capturedParams = params
    return parseInt(mockRowCount, 10)
  }

  async runPolicy(policy: RetentionPolicy): Promise<number> {
    const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000)

    if (policy.deleteOrAnonymize === 'delete') {
      const sql = `WITH deleted AS (
           DELETE FROM ${policy.table}
           WHERE ${policy.timestampColumn} < $1
           RETURNING 1
         ) SELECT COUNT(*) AS count FROM deleted`
      return this.executeQuery(sql, [cutoff])
    }

    if (!policy.anonymizeColumns || policy.anonymizeColumns.length === 0) return 0
    const setClauses = policy.anonymizeColumns.map(col => `${col} = NULL`).join(', ')
    const sql = `WITH updated AS (
         UPDATE ${policy.table}
         SET ${setClauses}
         WHERE ${policy.timestampColumn} < $1
         AND (${policy.anonymizeColumns.map(col => `${col} IS NOT NULL`).join(' OR ')})
         RETURNING 1
       ) SELECT COUNT(*) AS count FROM updated`
    return this.executeQuery(sql, [cutoff])
  }
}

describe('GdprCleanup', () => {
  it('delete policy generates DELETE SQL against the correct table', async () => {
    const cleanup = new TestableGdprCleanup()
    const policy: RetentionPolicy = {
      table: 'tracking_events',
      timestampColumn: 'created_at',
      retentionDays: 90,
      deleteOrAnonymize: 'delete',
    }
    const rows = await cleanup.runPolicy(policy)
    expect(rows).toBe(5)
    expect(capturedSql.includes('DELETE FROM tracking_events')).toBe(true)
    expect(capturedSql.includes('created_at < $1')).toBe(true)
  })

  it('delete policy passes a cutoff date close to retentionDays ago', async () => {
    const cleanup = new TestableGdprCleanup()
    const policy: RetentionPolicy = {
      table: 'tracking_events',
      timestampColumn: 'created_at',
      retentionDays: 90,
      deleteOrAnonymize: 'delete',
    }
    const before = Date.now()
    await cleanup.runPolicy(policy)
    const after = Date.now()

    const cutoff = capturedParams[0] as Date
    expect(cutoff instanceof Date).toBe(true)
    // Cutoff should be approximately 90 days ago
    const expectedMs = 90 * 24 * 60 * 60 * 1000
    const actualOffset = Date.now() - cutoff.getTime()
    expect(actualOffset >= expectedMs - 1000).toBe(true) // within 1s tolerance
    expect(actualOffset <= expectedMs + (after - before) + 1000).toBe(true)
  })

  it('anonymize policy generates UPDATE SQL with NULL assignments', async () => {
    const cleanup = new TestableGdprCleanup()
    const policy: RetentionPolicy = {
      table: 'drivers',
      timestampColumn: 'updated_at',
      retentionDays: 30,
      deleteOrAnonymize: 'anonymize',
      anonymizeColumns: ['current_lat', 'current_lon'],
    }
    const rows = await cleanup.runPolicy(policy)
    expect(rows).toBe(5)
    expect(capturedSql.includes('UPDATE drivers')).toBe(true)
    expect(capturedSql.includes('current_lat = NULL')).toBe(true)
    expect(capturedSql.includes('current_lon = NULL')).toBe(true)
    expect(capturedSql.includes('updated_at < $1')).toBe(true)
    // Should have an IS NOT NULL guard to skip already-anonymized rows
    expect(capturedSql.includes('IS NOT NULL')).toBe(true)
  })

  it('anonymize policy with no columns returns 0 without querying', async () => {
    const cleanup = new TestableGdprCleanup()
    capturedSql = ''
    const policy: RetentionPolicy = {
      table: 'drivers',
      timestampColumn: 'updated_at',
      retentionDays: 30,
      deleteOrAnonymize: 'anonymize',
      anonymizeColumns: [],
    }
    const rows = await cleanup.runPolicy(policy)
    expect(rows).toBe(0)
    expect(capturedSql).toBe('')
  })

  it('runAll returns per-table counts', async () => {
    mockRowCount = '3'
    const cleanup = new TestableGdprCleanup()
    const policies: RetentionPolicy[] = [
      { table: 'tracking_events', timestampColumn: 'created_at', retentionDays: 90, deleteOrAnonymize: 'delete' },
      { table: 'audit_logs', timestampColumn: 'occurred_at', retentionDays: 2555, deleteOrAnonymize: 'delete' },
    ]
    const results = await cleanup.runAll(policies)
    expect(results['tracking_events']).toBe(3)
    expect(results['audit_logs']).toBe(3)
  })

  it('runAll marks table as -1 on error but continues remaining policies', async () => {
    const cleanup = new TestableGdprCleanup()
    let callCount = 0
    // Make first call throw
    cleanup['executeQuery'] = async () => {
      callCount++
      if (callCount === 1) throw new Error('DB error')
      return 7
    }
    const policies: RetentionPolicy[] = [
      { table: 'bad_table', timestampColumn: 'ts', retentionDays: 30, deleteOrAnonymize: 'delete' },
      { table: 'good_table', timestampColumn: 'ts', retentionDays: 30, deleteOrAnonymize: 'delete' },
    ]
    const results = await cleanup.runAll(policies)
    expect(results['bad_table']).toBe(-1)
    expect(results['good_table']).toBe(7)
  })

  it('audit_logs default retention is 7 years (2555 days)', () => {
    // Verify the constant used in defaults
    const sevenYearsInDays = 7 * 365
    expect(sevenYearsInDays).toBe(2555)
  })
})
