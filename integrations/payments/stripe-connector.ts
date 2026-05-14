import { createHmac, timingSafeEqual } from 'crypto'
import { query } from '../../core/db/pool'
import { logger } from '../../core/logger/logger'
import * as https from 'https'

/**
 * STRIPE PAYMENT INTEGRATION
 *
 * Handles Stripe webhook events and payment operations:
 * - Webhook signature verification with replay protection
 * - Subscription management (create, update status)
 * - Overage charges via payment intents
 * - Event handlers for invoice.paid and payment_intent.payment_failed
 */

interface StripeWebhookEvent {
  id: string
  type: string
  created: number
  data: {
    object: Record<string, unknown>
  }
}

interface StripeCustomer {
  id: string
  email: string
}

interface StripeSubscription {
  id: string
  customer: string
  status: string
  current_period_start: number
  current_period_end: number
}

export class StripeConnector {
  private secretKey: string

  constructor(secretKey: string = process.env.STRIPE_SECRET_KEY || '') {
    this.secretKey = secretKey
  }

  /**
   * Verify Stripe webhook signature
   * Format: t=timestamp,v1=signature
   * Throws if signature is invalid or timestamp is stale (> 5 minutes)
   */
  verifyWebhookSignature(rawBody: Buffer, sigHeader: string | string[] | undefined, secret: string): StripeWebhookEvent {
    if (!sigHeader) {
      throw new Error('Missing X-Stripe-Signature header')
    }

    const headerStr = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader

    // Parse header: t=timestamp,v1=signature
    const parts = headerStr.split(',')
    let timestamp: number | null = null
    let signature: string | null = null

    for (const part of parts) {
      const [key, value] = part.split('=')
      if (key === 't') timestamp = parseInt(value)
      if (key === 'v1') signature = value
    }

    if (!timestamp || !signature) {
      throw new Error('Invalid X-Stripe-Signature format')
    }

    // Check timestamp is recent (within 5 minutes)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > 300) {
      throw new Error('Stripe webhook timestamp too old (replay protection)')
    }

    // Compute HMAC-SHA256: secret + timestamp + '.' + rawBody
    const signedContent = `${timestamp}.${rawBody.toString('utf8')}`
    const hmac = createHmac('sha256', secret)
    hmac.update(signedContent)
    const expected = hmac.digest('hex')

    // Timing-safe comparison
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new Error('Invalid Stripe webhook HMAC signature')
    }

    // Parse and return event
    const event = JSON.parse(rawBody.toString('utf8')) as StripeWebhookEvent
    return event
  }

  /**
   * Make authenticated HTTPS request to Stripe API
   */
  private async stripeRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    if (!this.secretKey) {
      throw new Error('STRIPE_SECRET_KEY not configured')
    }

    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.secretKey}:`).toString('base64')
      const bodyStr = body ? new URLSearchParams(body as Record<string, string>).toString() : ''

      const options = {
        hostname: 'api.stripe.com',
        port: 443,
        path,
        method,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }

      const req = https.request(options, (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              const error = JSON.parse(raw) as { error: { message: string } }
              reject(new Error(`Stripe API error: ${error.error.message}`))
            } else {
              resolve(JSON.parse(raw) as T)
            }
          } catch (e) {
            reject(new Error(`Failed to parse Stripe response: ${(e as Error).message}`))
          }
        })
      })

      req.on('error', reject)
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }

  /**
   * Create Stripe customer and subscription
   */
  async createSubscription(orgId: string, email: string, tier: string): Promise<{ customerId: string; subscriptionId: string }> {
    // Create customer
    const customer = await this.stripeRequest<StripeCustomer>('POST', '/v1/customers', {
      email,
      description: `Organization ${orgId}`,
      metadata: { org_id: orgId },
    })

    // Get price ID for tier (in production, use actual Stripe price IDs)
    const priceId = this.getPriceIdForTier(tier)

    // Create subscription
    const subscription = await this.stripeRequest<StripeSubscription>('POST', '/v1/subscriptions', {
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'error_if_incomplete',
      metadata: { org_id: orgId, tier },
    })

    // Store in database
    await query(
      `INSERT INTO billing_subscriptions (org_id, stripe_customer_id, stripe_subscription_id, tier, status, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
       ON CONFLICT (org_id) DO UPDATE SET
         stripe_customer_id = $2, stripe_subscription_id = $3, tier = $4, status = $5, updated_at = NOW()`,
      [
        orgId,
        customer.id,
        subscription.id,
        tier,
        subscription.status,
        subscription.current_period_start,
        subscription.current_period_end,
      ]
    )

    logger.info('Stripe subscription created', { orgId, tier, customerId: customer.id, subscriptionId: subscription.id })

    return { customerId: customer.id, subscriptionId: subscription.id }
  }

  /**
   * Charge for overage usage
   */
  async chargeOverage(customerId: string, amountCents: number, currency: string, description: string): Promise<string> {
    const paymentIntent = await this.stripeRequest<{ id: string; client_secret: string }>(
      'POST',
      '/v1/payment_intents',
      {
        amount: amountCents,
        currency: currency.toLowerCase(),
        customer: customerId,
        description,
        confirm: 'false',
      }
    )

    logger.info('Overage charge created', { customerId, amountCents, currency, paymentIntentId: paymentIntent.id })

    return paymentIntent.id
  }

  /**
   * Handle invoice.paid webhook event
   */
  async handleInvoicePaid(event: StripeWebhookEvent): Promise<void> {
    const invoice = event.data.object as { subscription?: string }
    const subscriptionId = invoice.subscription

    if (!subscriptionId) {
      logger.warn('Invoice paid event missing subscription ID')
      return
    }

    // Update subscription status
    await query(
      `UPDATE billing_subscriptions SET status = $1, updated_at = NOW() WHERE stripe_subscription_id = $2`,
      ['active', subscriptionId]
    )

    logger.info('Invoice paid — subscription activated', { subscriptionId })
  }

  /**
   * Handle payment_intent.payment_failed webhook event
   */
  async handlePaymentFailed(event: StripeWebhookEvent): Promise<void> {
    const paymentIntent = event.data.object as { customer?: string }
    const customerId = paymentIntent.customer

    if (!customerId) {
      logger.warn('Payment failed event missing customer ID')
      return
    }

    // Find subscription by customer
    const rows = await query<{ id: string }>(
      `SELECT id FROM billing_subscriptions WHERE stripe_customer_id = $1`,
      [customerId]
    )

    if (rows.length === 0) {
      logger.warn('No subscription found for failed payment', { customerId })
      return
    }

    // Update status to past_due
    await query(
      `UPDATE billing_subscriptions SET status = $1, updated_at = NOW() WHERE stripe_customer_id = $2`,
      ['past_due', customerId]
    )

    logger.info('Payment failed — subscription marked past due', { customerId })
  }

  /**
   * Get subscription status
   */
  async getSubscriptionStatus(orgId: string): Promise<{ tier: string; status: string } | null> {
    const rows = await query<{ tier: string; status: string }>(
      `SELECT tier, status FROM billing_subscriptions WHERE org_id = $1`,
      [orgId]
    )

    return rows.length > 0 ? rows[0] : null
  }

  // ===== PRIVATE HELPERS =====

  private getPriceIdForTier(tier: string): string {
    // In production, these would be actual Stripe price IDs
    const priceIds: Record<string, string> = {
      starter: 'price_starter_monthly',
      professional: 'price_professional_monthly',
      enterprise: 'price_enterprise_monthly',
    }

    return priceIds[tier] || priceIds.starter
  }
}

export const stripeConnector = new StripeConnector()
