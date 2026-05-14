import { query } from '../db/pool'
import { logger } from '../logger/logger'
import { scheduleJob } from '../queue/scheduler'

export interface RetentionPolicy {
  table: string
  timestampColumn: string
  retentionDays: number
  deleteOrAnonymize: 'delete' | 'anonymize'
  anonymizeColumns?: string[]
}

const DEFAULT_POLICIES: RetentionPolicy[] = [
  {
    table: 'tracking_events',
    timestampColumn: 'created_at',
    retentionDays: 90,
    deleteOrAnonymize: 'delete',
  },
  {
    table: 'drivers',
    timestampColumn: 'updated_at',
    retentionDays: 30,
    deleteOrAnonymize: 'anonymize',
    anonymizeColumns: ['current_lat', 'current_lon'],
  },
  {
    table: 'audit_logs',
    timestampColumn: 'occurred_at',
    retentionDays: 2555, // 7 years
    deleteOrAnonymize: 'delete',
  },
]

export class GdprCleanup {
  async runPolicy(policy: RetentionPolicy): Promise<number> {
    const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000)

    if (policy.deleteOrAnonymize === 'delete') {
      const result = await query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM ${policy.table}
           WHERE ${policy.timestampColumn} < $1
           RETURNING 1
         ) SELECT COUNT(*) AS count FROM deleted`,
        [cutoff]
      )
      const rows = parseInt(result[0]?.count ?? '0', 10)
      logger.info('GDPR cleanup: deleted rows', { table: policy.table, rows, cutoff })
      return rows
    }

    // anonymize
    if (!policy.anonymizeColumns || policy.anonymizeColumns.length === 0) return 0
    const setClauses = policy.anonymizeColumns.map(col => `${col} = NULL`).join(', ')
    const result = await query<{ count: string }>(
      `WITH updated AS (
         UPDATE ${policy.table}
         SET ${setClauses}
         WHERE ${policy.timestampColumn} < $1
         AND (${policy.anonymizeColumns.map(col => `${col} IS NOT NULL`).join(' OR ')})
         RETURNING 1
       ) SELECT COUNT(*) AS count FROM updated`,
      [cutoff]
    )
    const rows = parseInt(result[0]?.count ?? '0', 10)
    logger.info('GDPR cleanup: anonymized rows', { table: policy.table, rows, cutoff })
    return rows
  }

  async runAll(policies: RetentionPolicy[] = DEFAULT_POLICIES): Promise<Record<string, number>> {
    const results: Record<string, number> = {}
    for (const policy of policies) {
      try {
        results[policy.table] = await this.runPolicy(policy)
      } catch (err) {
        logger.error('GDPR cleanup failed for table', { table: policy.table, error: (err as Error).message })
        results[policy.table] = -1
      }
    }
    return results
  }
}

export const gdprCleanup = new GdprCleanup()

export async function registerGdprCleanupJob(): Promise<void> {
  await scheduleJob({
    name: 'gdpr-cleanup',
    queueName: 'gdpr',
    payload: { task: 'gdpr-cleanup' },
    intervalMs: 24 * 60 * 60 * 1000, // daily
  })
}
