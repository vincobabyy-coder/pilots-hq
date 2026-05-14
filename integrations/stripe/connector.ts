import { query } from '../../core/db/pool'
import { logger } from '../../core/logger/logger'
import { selectSecured } from '../../core/db/query-builder-secured'

/**
 * STRIPE PAYMENT INTEGRATION
 *
 * Features:
 * - Subscription billing (monthly charges)
 * - Usage overage billing (per-order charges)
 * - Failed payment handling
 * - Invoice management
 */

interface StripeCustomer {
  id: string // stripe_customer_id
  org_id: string
}

interface StripeSubscription {
  id: string
  customer_id: string
  status: 'active' | 'past_due' | 'unpaid' | 'canceled'
  current_period_end: Date
}

export class StripeConnector {
  private apiKey: string

  constructor(apiKey: string = process.env.STRIPE_API_KEY || '') {
    if (!apiKey) {
      logger.warn('STRIPE_API_KEY not set — payment features disabled')
    }
    this.apiKey = apiKey
  }

  /**
   * Create Stripe customer for new organization
   */
  async createCustomer(orgId: string, email: string, name: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Stripe API key not configured')
    }

    // In production, would call Stripe API:
    // const customer = await stripe.customers.create({
    //   email,
    //   name,
    //   metadata: { org_id: orgId }
    // });

    // For now, generate a mock ID
    const stripeCustomerId = `cus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Store in database
    await query(
      `INSERT INTO stripe_customers (org_id, stripe_customer_id, email, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [orgId, stripeCustomerId, email]
    )

    logger.info('Created Stripe customer', { orgId, stripeCustomerId })

    return stripeCustomerId
  }

  /**
   * Create subscription for organization
   */
  async createSubscription(
    orgId: string,
    tier: 'starter' | 'growth' | 'enterprise'
  ): Promise<{
    subscriptionId: string
    invoiceUrl: string
    nextBillingDate: Date
  }> {
    // Get Stripe customer ID
    const customers = await selectSecured('stripe_customers', orgId)
      .where('org_id', orgId)
      .execute<{ stripe_customer_id: string }>()

    if (customers.length === 0) {
      throw new Error('Stripe customer not found for organization')
    }

    const stripeCustomerId = customers[0].stripe_customer_id

    // Map tier to Stripe price ID
    const priceMap: Record<string, string> = {
      starter: 'price_starter',
      growth: 'price_growth',
      enterprise: 'price_enterprise',
    }

    const priceId = priceMap[tier]

    // In production, would call Stripe API:
    // const subscription = await stripe.subscriptions.create({
    //   customer: stripeCustomerId,
    //   items: [{ price: priceId }],
    //   metadata: { org_id: orgId, tier }
    // });

    // For now, generate mock data
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const nextBillingDate = new Date()
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1)

    // Store subscription
    await query(
      `INSERT INTO stripe_subscriptions (org_id, stripe_subscription_id, stripe_customer_id, tier, status, current_period_end, created_at)
       VALUES ($1, $2, $3, $4, 'active', $5, NOW())`,
      [orgId, subscriptionId, stripeCustomerId, tier, nextBillingDate]
    )

    logger.info('Created Stripe subscription', { orgId, tier, subscriptionId })

    return {
      subscriptionId,
      invoiceUrl: `https://invoice.stripe.com/${subscriptionId}`,
      nextBillingDate,
    }
  }

  /**
   * Charge for usage overages
   * Called when customer exceeds their tier's order limit
   */
  async chargeOverage(orgId: string, overageOrders: number): Promise<void> {
    if (overageOrders <= 0) return

    // Get Stripe customer
    const customers = await selectSecured('stripe_customers', orgId)
      .where('org_id', orgId)
      .execute<{ stripe_customer_id: string }>()

    if (customers.length === 0) {
      logger.error('No Stripe customer found for overage charge', { orgId })
      return
    }

    const stripeCustomerId = customers[0].stripe_customer_id
    const pricePerOrder = 0.1 // $0.10 per order
    const amount = Math.floor(overageOrders * pricePerOrder * 100) // Convert to cents

    // In production, would call Stripe API to create invoice item and invoice:
    // const item = await stripe.invoiceItems.create({
    //   customer: stripeCustomerId,
    //   amount,
    //   currency: 'usd',
    //   description: `Overage: ${overageOrders} orders`
    // });
    // const invoice = await stripe.invoices.create({
    //   customer: stripeCustomerId,
    //   collection_method: 'send_invoice'
    // });

    logger.info('Charged for overage', {
      orgId,
      orders: overageOrders,
      amount: `$${(amount / 100).toFixed(2)}`,
    })
  }

  /**
   * Handle failed payment (card declined, etc)
   */
  async handlePaymentFailed(orgId: string): Promise<void> {
    // 1. Notify customer (via email, in-app)
    // 2. Disable platform access (can't create new orders)
    // 3. Show payment link to retry
    // 4. After 3 failed attempts, suspend account

    const attempts = await query<{ retry_count: number }>(
      `SELECT COALESCE(retry_count, 0) as retry_count FROM payment_failures
       WHERE org_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [orgId]
    )

    const retryCount = (attempts[0]?.retry_count || 0) + 1

    if (retryCount >= 3) {
      // Suspend account
      await query('UPDATE organizations SET status = $1 WHERE id = $2', ['suspended', orgId])
      logger.warn('Organization suspended due to payment failures', { orgId, attempts: retryCount })
    } else {
      // Record failure and notify
      await query(
        `INSERT INTO payment_failures (org_id, retry_count, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (org_id) DO UPDATE SET retry_count = $2`,
        [orgId, retryCount]
      )

      logger.info('Payment failed, will retry', { orgId, attempt: retryCount })
    }
  }

  /**
   * Webhook handler: invoice paid
   */
  async onInvoicePaid(webhookData: unknown): Promise<void> {
    const data = webhookData as { object: { id: string; customer: string; status: string } }

    const invoiceId = data.object.id
    const customerId = data.object.customer

    logger.info('Invoice paid', { invoiceId, customerId })

    // Clear payment failure count
    const orgs = await query<{ org_id: string }>(
      'SELECT org_id FROM stripe_customers WHERE stripe_customer_id = $1',
      [customerId]
    )

    if (orgs.length > 0) {
      const orgId = orgs[0].org_id
      await query(
        'UPDATE payment_failures SET retry_count = 0 WHERE org_id = $1',
        [orgId]
      )
    }
  }

  /**
   * Webhook handler: invoice payment failed
   */
  async onInvoicePaymentFailed(webhookData: unknown): Promise<void> {
    const data = webhookData as { object: { id: string; customer: string } }

    const customerId = data.object.customer

    // Find organization
    const orgs = await query<{ org_id: string }>(
      'SELECT org_id FROM stripe_customers WHERE stripe_customer_id = $1',
      [customerId]
    )

    if (orgs.length > 0) {
      const orgId = orgs[0].org_id
      await this.handlePaymentFailed(orgId)
    }
  }

  /**
   * Get subscription status for organization
   */
  async getSubscriptionStatus(orgId: string): Promise<{
    tier: string
    status: string
    nextBillingDate: Date | null
    retryCount: number
  }> {
    const subs = await selectSecured('stripe_subscriptions', orgId)
      .where('org_id', orgId)
      .orderBy('created_at', 'DESC')
      .limit(1)
      .execute<{ tier: string; status: string; current_period_end: Date }>()

    const failures = await query<{ retry_count: number }>(
      `SELECT COALESCE(retry_count, 0) as retry_count FROM payment_failures
       WHERE org_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [orgId]
    )

    const retryCount = failures[0]?.retry_count || 0

    if (subs.length === 0) {
      return {
        tier: 'none',
        status: 'inactive',
        nextBillingDate: null,
        retryCount,
      }
    }

    const sub = subs[0]
    return {
      tier: sub.tier,
      status: sub.status,
      nextBillingDate: sub.current_period_end,
      retryCount,
    }
  }
}

export const stripeConnector = new StripeConnector()
