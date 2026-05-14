import { Router } from '../../core/http/router'
import { handleWebhook, createWebhookRoute } from '../../core/webhooks/webhook-handler'
import { logger } from '../../core/logger/logger'

export function webhooksRouter(): Router {
  const router = new Router()

  // Shopify webhooks
  router.post('/shopify/orders/create', createWebhookRoute('shopify'))
  router.post('/shopify/orders/updated', createWebhookRoute('shopify'))

  // Stripe webhooks
  router.post('/stripe/invoice.paid', createWebhookRoute('stripe'))
  router.post('/stripe/invoice.payment_failed', createWebhookRoute('stripe'))
  router.post('/stripe/customer.subscription.updated', createWebhookRoute('stripe'))

  // Twilio webhooks
  router.post('/twilio/sms/incoming', createWebhookRoute('twilio'))

  return router
}
