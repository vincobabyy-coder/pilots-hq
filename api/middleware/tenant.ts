import { Middleware } from '../../core/http/types'
import { queryOne } from '../../core/db/pool'

export const tenantContext: Middleware = async (req, res, next) => {
  // Skip for public routes (orgId will be undefined)
  if (!req.orgId) { await next(); return }

  const org = await queryOne<{ id: string; features: Record<string, unknown> }>(
    'SELECT id, features FROM organizations WHERE id = $1',
    [req.orgId]
  )

  if (!org) {
    res.status(401).fail('UNAUTHORIZED', 'Organization not found', 401)
    return
  }

  await next()
}
