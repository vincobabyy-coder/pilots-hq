import { Router } from '../../core/http/router'
import { query, transaction } from '../../core/db/pool'
import { auditLogger } from '../../core/audit/audit-logger'
import { logger } from '../../core/logger/logger'

export function privacyRouter(): Router {
  const router = new Router()

  // GET /my-data — return all data about the authenticated user (GDPR Article 15)
  router.get('/my-data', async (req, res) => {
    if (!req.userId || !req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401)
      return
    }

    try {
      const [userRows, auditRows] = await Promise.all([
        query<Record<string, unknown>>(
          'SELECT id, org_id, email, name, role, created_at FROM users WHERE id = $1',
          [req.userId]
        ),
        query<Record<string, unknown>>(
          `SELECT id, action, resource, resource_id, occurred_at
           FROM audit_logs WHERE actor_id = $1 AND org_id = $2
           ORDER BY occurred_at DESC LIMIT 100`,
          [req.userId, req.orgId]
        ),
      ])

      const user = userRows[0] ?? null

      await auditLogger.logExport({
        orgId: req.orgId,
        actorId: req.userId,
        action: 'my-data',
        resource: 'user',
        resourceId: req.userId,
        format: 'JSON',
        rows: auditRows.length,
        ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.headers['host'] as string | undefined,
        userAgent: req.headers['user-agent'] as string | undefined,
      })

      res.ok({ user, auditHistory: auditRows })
    } catch (err) {
      logger.error('GET /privacy/my-data failed', { error: (err as Error).message, userId: req.userId })
      res.status(500).fail('INTERNAL_ERROR', 'Failed to retrieve data', 500)
    }
  })

  // DELETE /delete-me — anonymize the requesting user's personal data (GDPR Article 17)
  router.delete('/delete-me', async (req, res) => {
    if (!req.userId || !req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Not authenticated', 401)
      return
    }

    try {
      // Get user's email before anonymization (needed for pseudonymization below)
      const userRows = await query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [req.userId]
      )
      const originalEmail = userRows[0]?.email ?? ''

      const userId = req.userId!
      const orgId = req.orgId!

      await transaction(async (client) => {
        // Anonymize user record
        await client.query<Record<string, unknown>>(
          `UPDATE users SET
             email = $1,
             name = 'Deleted User',
             password_hash = 'DELETED'
           WHERE id = $2`,
          [`deleted-${userId}@anon.invalid`, userId]
        )

        // Anonymize any driver record linked by email
        if (originalEmail) {
          await client.query<Record<string, unknown>>(
            `UPDATE drivers SET
               name = 'Deleted Driver',
               phone = '0000000000',
               email = NULL
             WHERE org_id = $1 AND email = $2`,
            [orgId, originalEmail]
          )
        }

        // Pseudonymize audit log actor_email (keep audit trail, replace PII)
        await client.query<Record<string, unknown>>(
          `UPDATE audit_logs SET actor_email = $1 WHERE actor_id = $2`,
          [`deleted-${userId}@anon.invalid`, userId]
        )
      })

      await auditLogger.logMutation({
        orgId: orgId,
        actorId: userId,
        action: 'user.self_deleted',
        resource: 'user',
        resourceId: userId,
        ipAddress: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim(),
        userAgent: req.headers['user-agent'] as string | undefined,
      })

      res.ok({ anonymized: true })
    } catch (err) {
      logger.error('DELETE /privacy/delete-me failed', { error: (err as Error).message, userId: req.userId })
      res.status(500).fail('INTERNAL_ERROR', 'Failed to delete data', 500)
    }
  })

  return router
}
