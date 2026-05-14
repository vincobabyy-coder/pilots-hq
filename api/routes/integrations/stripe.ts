import { PilotsRequest, PilotsResponse } from '../../../core/http/types'
import { Router } from '../../../core/http/router'
import { stripeConnector } from '../../../integrations/payments/stripe-connector'
import { logger } from '../../../core/logger/logger'

/**
 * Stripe Webhook Router
 *
 * Handles incoming Stripe webhooks:
 * - POST /webhook (invoice.paid, payment_intent.payment_failed events)
 */

export function stripeRouter(): Router {
  const router = new Router()

  /**
   * POST /webhook
   * Receives Stripe webhook events
   * Header: X-Stripe-Signature (t=timestamp,v1=signature)
   */
  router.post('/webhook', async (req: PilotsRequest, res: PilotsResponse) => {
    const sigHeader = req.headers['x-stripe-signature']

    // Validate rawBody exists
    if (!req.rawBody) {
      return res.status(400).fail(
        'MISSING_BODY',
        'Request body is required for webhook verification',
        400
      )
    }

    try {
      // Get the Stripe webhook secret from environment
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
      if (!webhookSecret) {
        logger.error('STRIPE_WEBHOOK_SECRET not configured')
        return res.status(500).fail(
          'CONFIG_ERROR',
          'Stripe webhook secret not configured',
          500
        )
      }

      // Verify webhook signature and parse event
      const event = stripeConnector.verifyWebhookSignature(
        req.rawBody,
        sigHeader,
        webhookSecret
      )

      // Route to appropriate handler based on event type
      if (event.type === 'invoice.paid') {
        await stripeConnector.handleInvoicePaid(event)
        logger.info('Stripe invoice.paid event processed', {
          eventId: event.id,
        })
      } else if (event.type === 'payment_intent.payment_failed') {
        await stripeConnector.handlePaymentFailed(event)
        logger.info('Stripe payment_intent.payment_failed event processed', {
          eventId: event.id,
        })
      } else {
        logger.debug('Stripe event received but not handled', {
          eventId: event.id,
          eventType: event.type,
        })
      }

      res.ok({
        received: true,
        eventId: event.id,
        eventType: event.type,
      })
    } catch (err) {
      const error = err as Error

      if (error.message.includes('Invalid Stripe webhook HMAC signature')) {
        logger.warn('Stripe webhook HMAC verification failed')
        return res.status(401).fail('INVALID_SIGNATURE', 'Webhook signature verification failed', 401)
      }

      if (error.message.includes('Stripe webhook timestamp too old')) {
        logger.warn('Stripe webhook timestamp too old (replay protection)')
        return res.status(401).fail('STALE_TIMESTAMP', 'Webhook timestamp too old', 401)
      }

      logger.error('Stripe webhook processing failed', {
        error: error.message,
      })

      res.status(400).fail('WEBHOOK_ERROR', error.message, 400)
    }
  })

  return router
}
