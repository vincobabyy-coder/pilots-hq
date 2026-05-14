import { query } from '../db/pool'
import { logger } from '../logger/logger'

export interface AuditEntry {
  orgId: string
  actorId?: string
  actorEmail?: string
  action: string
  resource: string
  resourceId?: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export class AuditLogger {
  async logMutation(entry: AuditEntry): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs
           (org_id, actor_id, actor_email, action, resource, resource_id,
            old_values, new_values, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10)`,
        [
          entry.orgId,
          entry.actorId ?? null,
          entry.actorEmail ?? null,
          entry.action,
          entry.resource,
          entry.resourceId ?? null,
          entry.oldValues != null ? JSON.stringify(entry.oldValues) : null,
          entry.newValues != null ? JSON.stringify(entry.newValues) : null,
          entry.ipAddress ?? null,
          entry.userAgent ?? null,
        ]
      )
    } catch (err) {
      // Audit must never crash the request — swallow and log
      logger.error('AuditLogger: failed to write log entry', { error: (err as Error).message, action: entry.action })
    }
  }

  async logSensitiveAccess(entry: Omit<AuditEntry, 'oldValues' | 'newValues'>): Promise<void> {
    const action = entry.action.startsWith('access.') ? entry.action : `access.${entry.action}`
    await this.logMutation({ ...entry, action })
  }

  async logExport(entry: Omit<AuditEntry, 'oldValues' | 'newValues'> & { format?: string; rows?: number }): Promise<void> {
    const action = entry.action.startsWith('export.') ? entry.action : `export.${entry.action}`
    await this.logMutation({
      ...entry,
      action,
      newValues: { format: entry.format, rows: entry.rows },
    })
  }
}

export const auditLogger = new AuditLogger()
