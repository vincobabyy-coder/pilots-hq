import { Router } from '../../core/http/router'
import { query } from '../../core/db/pool'
import { computeBill, forecastBill, persistBill } from '../../engines/pricing/engine'
import type { BillingInputs } from '../../engines/pricing/engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(
  err: unknown,
  res: import('../../core/http/types').PilotsResponse
): void {
  void err
  res.status(500).fail('INTERNAL_ERROR', 'Internal server error', 500)
}

type Tier = 'starter' | 'growth' | 'enterprise'
const VALID_TIERS: Tier[] = ['starter', 'growth', 'enterprise']

function parseBillingBody(
  body: Record<string, unknown>,
  orgId: string
): { ok: true; inputs: BillingInputs } | { ok: false; field: string; message: string } {
  const { tier, shipmentCount, routeCount, warehouseCount, apiCallCount, storageGb, periodDays } = body

  if (typeof tier !== 'string' || !VALID_TIERS.includes(tier as Tier)) {
    return { ok: false, field: 'tier', message: 'tier must be one of: starter, growth, enterprise' }
  }
  if (typeof shipmentCount !== 'number' || shipmentCount < 0) {
    return { ok: false, field: 'shipmentCount', message: 'shipmentCount must be a non-negative number' }
  }
  if (typeof routeCount !== 'number' || routeCount < 0) {
    return { ok: false, field: 'routeCount', message: 'routeCount must be a non-negative number' }
  }
  if (typeof warehouseCount !== 'number' || warehouseCount < 0) {
    return { ok: false, field: 'warehouseCount', message: 'warehouseCount must be a non-negative number' }
  }
  if (typeof apiCallCount !== 'number' || apiCallCount < 0) {
    return { ok: false, field: 'apiCallCount', message: 'apiCallCount must be a non-negative number' }
  }
  if (typeof storageGb !== 'number' || storageGb < 0) {
    return { ok: false, field: 'storageGb', message: 'storageGb must be a non-negative number' }
  }
  if (typeof periodDays !== 'number' || periodDays < 1) {
    return { ok: false, field: 'periodDays', message: 'periodDays must be a number >= 1' }
  }

  return {
    ok: true,
    inputs: {
      orgId,
      tier:           tier as Tier,
      shipmentCount:  shipmentCount as number,
      routeCount:     routeCount as number,
      warehouseCount: warehouseCount as number,
      apiCallCount:   apiCallCount as number,
      storageGb:      storageGb as number,
      periodDays:     periodDays as number,
    },
  }
}

/** Build a billing period window: periodStart = today − periodDays, periodEnd = today */
function buildPeriod(periodDays: number): { periodStart: Date; periodEnd: Date } {
  const periodEnd   = new Date()
  const periodStart = new Date(periodEnd)
  periodStart.setDate(periodEnd.getDate() - periodDays)
  return { periodStart, periodEnd }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function billingRouter(): Router {
  const router = new Router()

  // POST /compute — compute a bill and write to billing_audit
  router.post('/compute', async (req, res) => {
    if (!req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Authentication required', 401)
      return
    }

    const body  = req.body as Record<string, unknown>
    const parsed = parseBillingBody(body, req.orgId)

    if (!parsed.ok) {
      res.status(400).fail('VALIDATION_ERROR', parsed.message, 400, [
        { field: parsed.field, message: parsed.message },
      ])
      return
    }

    try {
      const { periodStart, periodEnd } = buildPeriod(parsed.inputs.periodDays)
      const bill = computeBill(parsed.inputs, periodStart, periodEnd)
      const auditId = await persistBill(bill)
      res.ok({ bill, auditId })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // POST /forecast — compute a bill without persisting to audit log
  router.post('/forecast', async (req, res) => {
    if (!req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Authentication required', 401)
      return
    }

    const body   = req.body as Record<string, unknown>
    const parsed = parseBillingBody(body, req.orgId)

    if (!parsed.ok) {
      res.status(400).fail('VALIDATION_ERROR', parsed.message, 400, [
        { field: parsed.field, message: parsed.message },
      ])
      return
    }

    try {
      const { periodStart, periodEnd } = buildPeriod(parsed.inputs.periodDays)
      const bill = forecastBill(parsed.inputs, periodStart, periodEnd)
      res.ok({ bill })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  // GET /history — last 12 billing_audit records for the authenticated org
  router.get('/history', async (req, res) => {
    if (!req.orgId) {
      res.status(401).fail('UNAUTHORIZED', 'Authentication required', 401)
      return
    }

    // Optional pagination: ?page=1 (1-indexed), defaults to first page of 12
    const pageParam  = req.query['page']
    const page       = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1
    const pageSize   = 12
    const offset     = (page - 1) * pageSize

    try {
      type AuditRow = {
        id:                 string
        org_id:             string
        period_start:       string
        period_end:         string
        line_items:         unknown
        total_amount_cents: string
        currency:           string
        computed_at:        string
        inputs:             unknown
      }

      const records = await query<AuditRow>(
        `SELECT id, org_id, period_start, period_end, line_items,
                total_amount_cents, currency, computed_at, inputs
           FROM billing_audit
          WHERE org_id = $1
          ORDER BY computed_at DESC
          LIMIT $2 OFFSET $3`,
        [req.orgId, pageSize, offset]
      )

      const countRows = await query<{ total: string }>(
        'SELECT COUNT(*) AS total FROM billing_audit WHERE org_id = $1',
        [req.orgId]
      )
      const total = parseInt(countRows[0]?.total ?? '0', 10)

      res.ok({
        records,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      })
    } catch (err) {
      handleServiceError(err, res)
    }
  })

  return router
}
