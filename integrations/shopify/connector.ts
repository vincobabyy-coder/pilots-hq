import * as crypto from 'crypto'
import { query } from '../../core/db/pool'
import { encryptField, decryptField, getEncryptionKey } from '../../core/crypto/field-encryption'
import { logger } from '../../core/logger/logger'

/**
 * SHOPIFY INTEGRATION CONNECTOR
 *
 * Manages OAuth token storage and webhook signature verification for Shopify.
 * All tokens are encrypted at rest using AES-256-GCM.
 */

export interface ShopifyOrder {
  id: number
  order_number: string
  customer: {
    email: string
    first_name: string
    last_name: string
    phone: string
  }
  shipping_address: {
    address1: string
    address2?: string
    city: string
    province: string
    postal_code: string
    country: string
    phone: string
  }
  line_items: Array<{
    id: number
    title: string
    quantity: number
    price: string
    sku: string
  }>
  total_price: string
  currency: string
  created_at: string
  updated_at: string
}

export interface PilotsOrderInput {
  org_id: string
  external_order_id: string
  external_source: 'shopify'
  customer_name: string
  customer_email: string
  customer_phone: string
  delivery_address: string
  delivery_city: string
  delivery_province: string
  delivery_postal_code: string
  total_amount_cents: number
  currency: string
  items_json: string
  created_at: Date
}

export class ShopifyConnector {
  /**
   * Save Shopify connection with encrypted tokens
   */
  static async saveConnection(
    orgId: string,
    shopDomain: string,
    accessToken: string,
    webhookSecret: string
  ): Promise<void> {
    try {
      const key = getEncryptionKey()
      const accessTokenEncrypted = encryptField(accessToken, key)
      const webhookSecretEncrypted = encryptField(webhookSecret, key)

      await query(
        `INSERT INTO shopify_connections (org_id, shop_domain, access_token_encrypted, webhook_hmac_secret_encrypted)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, shop_domain) DO UPDATE SET
           access_token_encrypted = EXCLUDED.access_token_encrypted,
           webhook_hmac_secret_encrypted = EXCLUDED.webhook_hmac_secret_encrypted,
           updated_at = NOW()`,
        [orgId, shopDomain, accessTokenEncrypted, webhookSecretEncrypted]
      )

      logger.info('Shopify connection saved', { orgId, shopDomain })
    } catch (err) {
      logger.error('Failed to save Shopify connection', {
        orgId,
        shopDomain,
        error: (err as Error).message,
      })
      throw err
    }
  }

  /**
   * Retrieve and decrypt Shopify connection for a shop
   */
  static async getConnection(
    orgId: string,
    shopDomain: string
  ): Promise<{ accessToken: string; webhookSecret: string } | null> {
    try {
      const rows = await query<{
        access_token_encrypted: string
        webhook_hmac_secret_encrypted: string
      }>(
        `SELECT access_token_encrypted, webhook_hmac_secret_encrypted FROM shopify_connections
         WHERE org_id = $1 AND shop_domain = $2`,
        [orgId, shopDomain]
      )

      if (rows.length === 0) return null

      const key = getEncryptionKey()
      const { access_token_encrypted, webhook_hmac_secret_encrypted } = rows[0]

      return {
        accessToken: decryptField(access_token_encrypted, key),
        webhookSecret: decryptField(webhook_hmac_secret_encrypted, key),
      }
    } catch (err) {
      logger.error('Failed to retrieve Shopify connection', {
        orgId,
        shopDomain,
        error: (err as Error).message,
      })
      throw err
    }
  }

  /**
   * Verify Shopify webhook HMAC signature
   * Returns true if the signature is valid, false otherwise
   */
  static verifyWebhookSignature(
    rawBody: Buffer,
    hmacHeader: string | undefined,
    secret: string
  ): boolean {
    if (!hmacHeader) return false

    try {
      const expectedHmac = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('base64')

      // Constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(expectedHmac, 'utf8'),
        Buffer.from(hmacHeader, 'utf8')
      )
    } catch (err) {
      logger.warn('HMAC verification failed', { error: (err as Error).message })
      return false
    }
  }

  /**
   * Map Shopify order to PILOTS order structure
   */
  static mapShopifyOrderToPilots(shopifyOrder: ShopifyOrder, orgId: string): PilotsOrderInput {
    const shippingAddr = shopifyOrder.shipping_address

    const items = shopifyOrder.line_items.map((item) => ({
      external_line_item_id: item.id.toString(),
      title: item.title,
      quantity: item.quantity,
      price_cents: Math.round(parseFloat(item.price) * 100),
      sku: item.sku,
    }))

    return {
      org_id: orgId,
      external_order_id: shopifyOrder.order_number,
      external_source: 'shopify',
      customer_name: `${shopifyOrder.customer.first_name} ${shopifyOrder.customer.last_name}`,
      customer_email: shopifyOrder.customer.email,
      customer_phone: shopifyOrder.customer.phone || '',
      delivery_address: `${shippingAddr.address1}${shippingAddr.address2 ? ' ' + shippingAddr.address2 : ''}`,
      delivery_city: shippingAddr.city,
      delivery_province: shippingAddr.province,
      delivery_postal_code: shippingAddr.postal_code,
      total_amount_cents: Math.round(parseFloat(shopifyOrder.total_price) * 100),
      currency: shopifyOrder.currency,
      items_json: JSON.stringify(items),
      created_at: new Date(shopifyOrder.created_at),
    }
  }

  /**
   * Handle incoming Shopify order.created webhook
   */
  static async onOrderCreated(
    rawBody: Buffer,
    hmacHeader: string | undefined,
    orgId: string,
    shopDomain: string
  ): Promise<ShopifyOrder> {
    // Verify HMAC signature
    const connection = await this.getConnection(orgId, shopDomain)
    if (!connection) {
      throw new Error(`Shopify connection not found for ${shopDomain}`)
    }

    const isValid = this.verifyWebhookSignature(rawBody, hmacHeader, connection.webhookSecret)
    if (!isValid) {
      throw new Error('Invalid Shopify webhook HMAC signature')
    }

    // Parse webhook payload
    let shopifyOrder: ShopifyOrder
    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as ShopifyOrder
      shopifyOrder = payload
    } catch (err) {
      throw new Error(`Failed to parse Shopify webhook payload: ${(err as Error).message}`)
    }

    logger.info('Shopify order webhook received', {
      orgId,
      shopDomain,
      orderNumber: shopifyOrder.order_number,
    })

    return shopifyOrder
  }
}

export const shopifyConnector = ShopifyConnector
