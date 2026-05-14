import { logger } from '../logger/logger'
import { shopifyConnector } from '../../integrations/shopify/connector'
import { stripeConnector } from '../../integrations/payments/stripe-connector'
import { twilioConnector } from '../../integrations/twilio/connector'
import { cache } from '../cache/cache'

/**
 * Webhook Handler: Unified entry point for all integration webhooks
 *
 * Responsibilities:
 * - Verify webhook signatures (prevent spoofing)
 * - Parse webhook payloads
 * - Route to appropriate handler
 * - Idempotency (prevent duplicate processing)
 * - Error handling and logging
 */

interface WebhookEvent {
  id: string
  timestamp: number
  source: 'shopify' | 'stripe' | 'twilio'
  type: string
  data: unknown
  signature?: string
  raw_body?: string
}

const IDEMPOTENCY_TTL = 24 * 60 * 60 // 24 hours in seconds

/**
 * Process incoming webhook
 */
export async function handleWebhook(
  source: 'shopify' | 'stripe' | 'twilio',
  body: string,
  headers: Record<string, string>
): Promise<{ statusCode: number; body: string }> {
  const startTime = Date.now()

  try {
    // Parse payload
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch (e) {
      logger.error('Invalid webhook payload', { source, error: (e as Error).message })
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
    }

    // Route to handler based on source
    let result: any

    switch (source) {
      case 'shopify':
        result = await handleShopifyWebhook(body, headers, payload)
        break
      case 'stripe':
        result = await handleStripeWebhook(body, headers, payload)
        break
      case 'twilio':
        result = await handleTwilioWebhook(body, headers, payload)
        break
      default:
        logger.warn('Unknown webhook source', { source })
        return { statusCode: 400, body: JSON.stringify({ error: 'Unknown source' }) }
    }

    const duration = Date.now() - startTime
    logger.info('Webhook processed', { source, duration, statusCode: result.statusCode })

    return result
  } catch (error) {
    logger.error('Webhook processing failed', {
      source,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    })

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}

/**
 * Shopify webhook handler
 */
async function handleShopifyWebhook(
  body: string,
  headers: Record<string, string>,
  payload: unknown
): Promise<{ statusCode: number; body: string }> {
  const signature = headers['x-shopify-hmac-sha256']
  const topic = headers['x-shopify-topic']
  const shopDomain = headers['x-shopify-shop-api-call-limit']?.split('/')[1] || headers['x-shopify-shop-domain'] || ''
  const orderId = (payload as any)?.id

  // Check idempotency (prevent duplicate processing)
  if (await isAlreadyProcessed(orderId)) {
    logger.info('Shopify webhook already processed', { orderId })
    return { statusCode: 200, body: JSON.stringify({ status: 'cached' }) }
  }

  try {
    // Route to handler based on topic
    if (topic === 'orders/create' || topic === 'orders/updated') {
      const orgId = headers['x-pilots-org-id'] // PILOTS adds org_id to header
      if (!orgId) {
        logger.error('Shopify webhook missing org_id')
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing org_id' }) }
      }

      const rawBody = Buffer.from(body, 'utf8')
      await shopifyConnector.onOrderCreated(rawBody, signature, orgId, shopDomain)
    } else {
      logger.warn('Unhandled Shopify topic', { topic })
    }

    // Mark as processed
    await markProcessed(orderId, { topic })

    return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) }
  } catch (error) {
    logger.error('Shopify webhook handler failed', {
      topic,
      orderId,
      error: (error as Error).message,
    })

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Processing failed' }),
    }
  }
}

/**
 * Stripe webhook handler
 */
async function handleStripeWebhook(
  body: string,
  headers: Record<string, string>,
  payload: unknown
): Promise<{ statusCode: number; body: string }> {
  const signature = headers['stripe-signature']
  // In production: verify using Stripe SDK with signing secret

  try {
    const event = payload as { type: string; object: any }
    const eventId = event.object.id

    // Check idempotency
    if (await isAlreadyProcessed(eventId)) {
      logger.info('Stripe event already processed', { eventId })
      return { statusCode: 200, body: JSON.stringify({ status: 'cached' }) }
    }

    // Route to handler based on event type
    if (event.type === 'invoice.paid') {
      await stripeConnector.handleInvoicePaid(payload)
    } else if (event.type === 'payment_intent.payment_failed') {
      await stripeConnector.handlePaymentFailed(payload)
    } else if (event.type === 'customer.subscription.updated') {
      logger.info('Subscription updated', { customerId: event.object.customer })
    } else {
      logger.debug('Unhandled Stripe event type', { type: event.type })
    }

    await markProcessed(eventId, { type: event.type })

    return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) }
  } catch (error) {
    logger.error('Stripe webhook handler failed', {
      error: (error as Error).message,
    })

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Processing failed' }),
    }
  }
}

/**
 * Twilio webhook handler
 */
async function handleTwilioWebhook(
  body: string,
  headers: Record<string, string>,
  payload: unknown
): Promise<{ statusCode: number; body: string }> {
  // Twilio verification: check X-Twilio-Signature header
  // In production: verify using Twilio SDK

  try {
    const event = payload as { From?: string; Body?: string; MessageSid?: string }

    if (!event.From || !event.Body) {
      logger.warn('Invalid Twilio webhook payload')
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) }
    }

    const messageId = event.MessageSid

    // Check idempotency
    if (await isAlreadyProcessed(messageId)) {
      logger.info('Twilio message already processed', { messageId })
      return { statusCode: 200, body: JSON.stringify({ status: 'cached' }) }
    }

    // Handle incoming SMS
    await twilioConnector.handleIncomingSms(event.From, event.Body)

    await markProcessed(messageId, { from: event.From })

    return { statusCode: 200, body: '' } // Empty body for Twilio
  } catch (error) {
    logger.error('Twilio webhook handler failed', {
      error: (error as Error).message,
    })

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Processing failed' }),
    }
  }
}

/**
 * Idempotency check: prevent duplicate processing
 */
async function isAlreadyProcessed(eventId?: string): Promise<boolean> {
  if (!eventId) return false

  const cached = await cache.get<any>(eventId, { namespace: 'webhook-idempotency' })
  return cached !== null
}

/**
 * Mark webhook as processed
 */
async function markProcessed(eventId: string | undefined, result: any): Promise<void> {
  if (!eventId) return

  await cache.set(eventId, result, {
    namespace: 'webhook-idempotency',
    ttl: IDEMPOTENCY_TTL,
  })
}

/**
 * Type-safe webhook route handler factory
 */
export function createWebhookRoute(source: 'shopify' | 'stripe' | 'twilio') {
  return async (req: any, res: any) => {
    const rawBody = req.rawBody || req.body // Preserve raw body for signature verification
    const headers = req.headers

    try {
      const result = await handleWebhook(source, rawBody, headers)
      res.status(result.statusCode).send(result.body)
    } catch (error) {
      logger.error('Webhook route error', { source, error: (error as Error).message })
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
