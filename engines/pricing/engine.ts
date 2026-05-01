// ---------------------------------------------------------------------------
// Billing DSL evaluator
// Runs all billing rules against a set of inputs and produces a BillResult
// with per-line explanations. Optionally persists to the billing_audit table.
// ---------------------------------------------------------------------------

import { query } from '../../core/db/pool'
import { BILLING_RULES } from './rules'
import type { BillingInputs } from './rules'

export type { BillingInputs }

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BillingLineItem {
  ruleId:      string
  name:        string
  description: string
  /** Number of units used (shipments, GB, API calls, etc.) */
  quantity:    number
  /** Price per unit in cents */
  unitCents:   number
  /** Total charge in cents for this line */
  totalCents:  number
  /** Human-readable explanation, e.g. "50 shipments × $0.50 = $25.00" */
  explanation: string
}

export interface BillResult {
  orgId:         string
  periodStart:   string   // ISO date string YYYY-MM-DD
  periodEnd:     string   // ISO date string YYYY-MM-DD
  lineItems:     BillingLineItem[]
  subtotalCents: number
  totalCents:    number   // same as subtotalCents — no tax layer yet
  currency:      'USD'
  computedAt:    string   // ISO-8601 timestamp
  inputs:        BillingInputs
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents as a dollar amount string, e.g. 2500 → "$25.00" */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** Format an ISO date from a Date object */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Per-rule line-item builders
// Each rule knows its own quantity/unit structure, so we compute metadata here
// for the explanation string rather than duplicating logic in rules.ts.
// ---------------------------------------------------------------------------

function buildLineItem(inputs: BillingInputs, ruleId: string): BillingLineItem {
  const rule = BILLING_RULES.find(r => r.ruleId === ruleId)!
  const totalCents = rule.compute(inputs)

  let quantity = 1
  let unitCents = totalCents
  let explanation = ''

  switch (ruleId) {
    case 'base_monthly_fee': {
      quantity  = 1
      unitCents = totalCents
      explanation = `1 × ${formatCents(totalCents)} (${inputs.tier} plan) = ${formatCents(totalCents)}`
      break
    }
    case 'per_shipment_fee': {
      quantity  = inputs.shipmentCount
      unitCents = inputs.shipmentCount > 0 ? Math.round(totalCents / inputs.shipmentCount) : 0
      explanation = `${quantity} shipments × ${formatCents(unitCents)} = ${formatCents(totalCents)}`
      break
    }
    case 'per_route_fee': {
      quantity  = inputs.routeCount
      unitCents = 100
      explanation = `${quantity} routes × ${formatCents(100)} = ${formatCents(totalCents)}`
      break
    }
    case 'warehouse_fee': {
      quantity  = inputs.warehouseCount
      // unitCents here is the prorated per-warehouse cost
      unitCents = quantity > 0 ? Math.round(totalCents / quantity) : 0
      explanation = `${quantity} warehouses × ${formatCents(unitCents)} (prorated ${inputs.periodDays}/30 days) = ${formatCents(totalCents)}`
      break
    }
    case 'api_overage_fee': {
      const freeTiers: Record<BillingInputs['tier'], number> = {
        starter: 10_000, growth: 50_000, enterprise: Infinity,
      }
      const free    = freeTiers[inputs.tier]
      const overage = Math.max(0, inputs.apiCallCount - (isFinite(free) ? free : inputs.apiCallCount))
      quantity  = overage
      unitCents = 1
      if (overage === 0) {
        explanation = `${inputs.apiCallCount.toLocaleString()} calls within free allowance (${isFinite(free) ? free.toLocaleString() : 'unlimited'}) = $0.00`
      } else {
        explanation = `${overage.toLocaleString()} overage calls × ${formatCents(1)} = ${formatCents(totalCents)}`
      }
      break
    }
    case 'storage_fee': {
      const freeGb   = 5
      const billable = Math.max(0, inputs.storageGb - freeGb)
      quantity  = billable
      unitCents = 10
      if (billable === 0) {
        explanation = `${inputs.storageGb} GB within ${freeGb} GB free tier = $0.00`
      } else {
        explanation = `${billable} GB above ${freeGb} GB free tier × ${formatCents(10)} = ${formatCents(totalCents)}`
      }
      break
    }
    default: {
      explanation = `${formatCents(totalCents)}`
    }
  }

  return {
    ruleId:      rule.ruleId,
    name:        rule.name,
    description: rule.description,
    quantity,
    unitCents,
    totalCents,
    explanation,
  }
}

// ---------------------------------------------------------------------------
// Core compute function
// ---------------------------------------------------------------------------

export function computeBill(
  inputs: BillingInputs,
  periodStart: Date,
  periodEnd:   Date,
): BillResult {
  const lineItems: BillingLineItem[] = BILLING_RULES.map(rule =>
    buildLineItem(inputs, rule.ruleId)
  )

  const subtotalCents = lineItems.reduce((sum, li) => sum + li.totalCents, 0)

  return {
    orgId:         inputs.orgId,
    periodStart:   toISODate(periodStart),
    periodEnd:     toISODate(periodEnd),
    lineItems,
    subtotalCents,
    totalCents:    subtotalCents,
    currency:      'USD',
    computedAt:    new Date().toISOString(),
    inputs,
  }
}

// ---------------------------------------------------------------------------
// Persist to billing_audit table; returns the generated UUID
// ---------------------------------------------------------------------------

export async function persistBill(bill: BillResult): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO billing_audit
       (org_id, period_start, period_end, line_items, total_amount_cents, currency, computed_at, inputs)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      bill.orgId,
      bill.periodStart,
      bill.periodEnd,
      JSON.stringify(bill.lineItems),
      bill.totalCents,
      bill.currency,
      bill.computedAt,
      JSON.stringify(bill.inputs),
    ]
  )

  const row = rows[0]
  if (!row) {
    throw new Error('billing_audit INSERT returned no row')
  }
  return row.id
}

// ---------------------------------------------------------------------------
// Forecast — same computation, no persistence side-effect
// ---------------------------------------------------------------------------

export function forecastBill(
  inputs: BillingInputs,
  periodStart: Date,
  periodEnd:   Date,
): BillResult {
  return computeBill(inputs, periodStart, periodEnd)
}
