// ---------------------------------------------------------------------------
// Billing rule definitions
// Each rule is a pure function: receives BillingInputs, returns amount in cents.
// ---------------------------------------------------------------------------

export interface BillingInputs {
  orgId:          string
  tier:           'starter' | 'growth' | 'enterprise'
  shipmentCount:  number
  routeCount:     number
  warehouseCount: number
  apiCallCount:   number
  storageGb:      number
  periodDays:     number
}

export interface BillingRule {
  ruleId:      string
  name:        string
  description: string
  tier:        'starter' | 'growth' | 'enterprise' | 'all'
  compute(inputs: BillingInputs): number  // returns amount in cents
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const BASE_MONTHLY_FEE: BillingRule = {
  ruleId:      'base_monthly_fee',
  name:        'Base Monthly Fee',
  description: 'Fixed monthly platform access fee based on plan tier.',
  tier:        'all',
  compute(inputs) {
    const fees: Record<BillingInputs['tier'], number> = {
      starter:    2900,
      growth:     9900,
      enterprise: 29900,
    }
    return fees[inputs.tier]
  },
}

const PER_SHIPMENT_FEE: BillingRule = {
  ruleId:      'per_shipment_fee',
  name:        'Per Shipment Fee',
  description: 'Charged per shipment processed in the billing period.',
  tier:        'all',
  compute(inputs) {
    const unitCents: Record<BillingInputs['tier'], number> = {
      starter:    50,
      growth:     30,
      enterprise: 15,
    }
    return inputs.shipmentCount * unitCents[inputs.tier]
  },
}

const PER_ROUTE_FEE: BillingRule = {
  ruleId:      'per_route_fee',
  name:        'Per Route Fee',
  description: 'Flat fee per optimized route dispatched, same across all tiers.',
  tier:        'all',
  compute(inputs) {
    return inputs.routeCount * 100
  },
}

const WAREHOUSE_FEE: BillingRule = {
  ruleId:      'warehouse_fee',
  name:        'Warehouse Fee',
  description: 'Monthly charge per connected warehouse, prorated by billing period length.',
  tier:        'all',
  compute(inputs) {
    const monthlyUnitCents: Record<BillingInputs['tier'], number> = {
      starter:    500,
      growth:     300,
      enterprise: 200,
    }
    // Prorated: multiply monthly rate by (periodDays / 30)
    const proration = inputs.periodDays / 30
    return Math.round(inputs.warehouseCount * monthlyUnitCents[inputs.tier] * proration)
  },
}

const API_OVERAGE_FEE: BillingRule = {
  ruleId:      'api_overage_fee',
  name:        'API Overage Fee',
  description: 'Charge for API calls beyond the free tier allowance (1 cent per extra call). Enterprise has no limit.',
  tier:        'all',
  compute(inputs) {
    const freeTier: Record<BillingInputs['tier'], number> = {
      starter:    10_000,
      growth:     50_000,
      enterprise: Infinity,
    }
    const free = freeTier[inputs.tier]
    const overage = Math.max(0, inputs.apiCallCount - free)
    return overage * 1  // 1 cent per extra call
  },
}

const STORAGE_FEE: BillingRule = {
  ruleId:      'storage_fee',
  name:        'Storage Fee',
  description: 'Charge for storage above the 5 GB free tier at 10 cents per GB.',
  tier:        'all',
  compute(inputs) {
    const freeGb = 5
    const billableGb = Math.max(0, inputs.storageGb - freeGb)
    return Math.round(billableGb * 10)  // 10 cents per GB
  },
}

// Exported as an ordered list — order determines line-item rendering order.
export const BILLING_RULES: BillingRule[] = [
  BASE_MONTHLY_FEE,
  PER_SHIPMENT_FEE,
  PER_ROUTE_FEE,
  WAREHOUSE_FEE,
  API_OVERAGE_FEE,
  STORAGE_FEE,
]
