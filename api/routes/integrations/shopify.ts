import { PilotsRequest, PilotsResponse } from '../../../core/http/types'
import { Router } from '../../../core/http/router'
import { ShopifyConnector } from '../../../integrations/shopify/connector'
import { logger } from '../../../core/logger/logger'

/**
 * Shopify Webhook Router
 *
 * Handles incoming Shopify webhooks:
 * - POST /webhook (order.created event)
 */

export function shopifyRouter(): Router {
  const router = new Router()

  /**
   * POST /webhook
   * Receives Shopify order.created webhook
   * Query params: org_id (required), shop_domain (required)
   */
  router.post('/webhook', async (req: PilotsRequest, res: PilotsResponse) => {
    const orgId = req.query.org_id
    const shopDomain = req.query.shop_domain
    const hmacHeader = req.headers['x-shopify-hmac-sha256']

    // Validate required parameters
    if (!orgId || !shopDomain) {
      return res.status(400).fail(
        'MISSING_PARAMS',
        'org_id and shop_domain query parameters are required',
        400
      )
    }

    // Validate rawBody exists
    if (!req.rawBody) {
      return res.status(400).fail(
        'MISSING_BODY',
        'Request body is required for webhook verification',
        400
      )
    }

    try {
      // Verify webhook signature and parse order
      const shopifyOrder = await ShopifyConnector.onOrderCreated(
        req.rawBody,
        hmacHeader,
        orgId,
        shopDomain
      )

      logger.info('Shopify webhook processed successfully', {
        orgId,
        shopDomain,
        orderNumber: shopifyOrder.order_number,
      })

      // Note: The actual order creation and route optimization would happen here
      // In a full implementation, you'd call orderService.createOrder() and trigger the VRP solver
      // For now, just acknowledge receipt
      res.ok({
        received: true,
        orderNumber: shopifyOrder.order_number,
      })
    } catch (err) {
      const error = err as Error

      if (error.message.includes('Invalid Shopify webhook HMAC signature')) {
        logger.warn('Shopify webhook HMAC verification failed', {
          orgId,
          shopDomain,
        })
        return res.status(401).fail('INVALID_SIGNATURE', 'Webhook HMAC verification failed', 401)
      }

      if (error.message.includes('Shopify connection not found')) {
        logger.warn('Shopify connection not found', { orgId, shopDomain })
        return res.status(404).fail('NOT_FOUND', 'Shopify connection not configured', 404)
      }

      logger.error('Shopify webhook processing failed', {
        orgId,
        shopDomain,
        error: error.message,
      })

      res.status(400).fail('WEBHOOK_ERROR', error.message, 400)
    }
  })

  return router
}
