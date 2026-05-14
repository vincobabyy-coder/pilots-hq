// tests/integration/shopify.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request, baseUrl } from './helpers/server'
import { createOrg } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'
import { createHmac } from 'crypto'
import { encryptField, getEncryptionKey } from '../../core/crypto/field-encryption'

describe('Shopify Integration', () => {
  let orgId = ''
  let shopDomain = 'test-shop.myshopify.com'
  const webhookSecret = 'test-webhook-secret'

  it('starts server and creates test data', async () => {
    await startTestServer()

    // Create a test organization
    const org = await createOrg('Shopify Test Org', `shopify-test-${Date.now()}`)
    orgId = org.id

    // Insert a Shopify connection with encrypted tokens
    const encKey = getEncryptionKey()
    const encryptedToken = encryptField('test-access-token-123', encKey)
    const encryptedSecret = encryptField(webhookSecret, encKey)

    await query(
      `INSERT INTO shopify_connections (org_id, shop_domain, access_token_encrypted, webhook_hmac_secret_encrypted)
       VALUES ($1, $2, $3, $4)`,
      [orgId, shopDomain, encryptedToken, encryptedSecret]
    )

    expect(orgId).toBeTruthy()
    expect(typeof orgId).toBe('string')
  })

  it('valid HMAC signature creates order successfully', async () => {
    const shopifyOrder = {
      id: 'gid://shopify/Order/123456789',
      order_number: 1001,
      created_at: new Date().toISOString(),
      email: 'customer@example.com',
      shipping_address: {
        first_name: 'John',
        last_name: 'Doe',
        address1: '123 Main St',
        city: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      },
      line_items: [
        {
          id: 'gid://shopify/LineItem/1',
          sku: 'PROD-001',
          title: 'Test Product',
          quantity: 2,
          price: '99.99',
        },
      ],
    }

    const body = JSON.stringify(shopifyOrder)
    const hmac = createHmac('sha256', webhookSecret)
      .update(body, 'utf8')
      .digest('base64')

    // Use a raw HTTP request since we need to send rawBody
    const url = new URL(`/api/v1/integrations/shopify/webhook?org_id=${orgId}&shop_domain=${shopDomain}`, baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': hmac,
          'Content-Length': Buffer.byteLength(body),
        },
      }

      const req = http.request(options, (res: any) => {
        let raw = ''
        res.on('data', (chunk: any) => { raw += chunk })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} })
          }
        })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })

    expect(response.status).toBe(200)
    expect((response.body as Record<string, unknown>).data).toBeTruthy()
    const data = (response.body as Record<string, unknown>).data as Record<string, unknown>
    expect(data.received).toBe(true)
    expect(data.orderNumber).toBe(1001)
  })

  it('invalid HMAC signature returns 401', async () => {
    const shopifyOrder = {
      id: 'gid://shopify/Order/987654321',
      order_number: 1002,
      created_at: new Date().toISOString(),
      email: 'customer2@example.com',
      shipping_address: {
        first_name: 'Jane',
        last_name: 'Doe',
        address1: '456 Oak Ave',
        city: 'Accra',
        postal_code: '00101',
        country: 'GH',
      },
      line_items: [],
    }

    const body = JSON.stringify(shopifyOrder)
    const invalidHmac = 'invalid-hmac-signature-xyz'

    const url = new URL(`/api/v1/integrations/shopify/webhook?org_id=${orgId}&shop_domain=${shopDomain}`, baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': invalidHmac,
          'Content-Length': Buffer.byteLength(body),
        },
      }

      const req = http.request(options, (res: any) => {
        let raw = ''
        res.on('data', (chunk: any) => { raw += chunk })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} })
          }
        })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })

    expect(response.status).toBe(401)
    expect((response.body as Record<string, unknown>).error).toBeTruthy()
    const error = (response.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('INVALID_SIGNATURE')
  })

  it('missing connection returns 404', async () => {
    const shopifyOrder = {
      id: 'gid://shopify/Order/555555555',
      order_number: 1003,
      created_at: new Date().toISOString(),
      email: 'customer3@example.com',
      shipping_address: {},
      line_items: [],
    }

    const body = JSON.stringify(shopifyOrder)
    const unknownDomain = 'unknown-shop.myshopify.com'
    const hmac = createHmac('sha256', 'wrong-secret')
      .update(body, 'utf8')
      .digest('base64')

    const url = new URL(`/api/v1/integrations/shopify/webhook?org_id=${orgId}&shop_domain=${unknownDomain}`, baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': hmac,
          'Content-Length': Buffer.byteLength(body),
        },
      }

      const req = http.request(options, (res: any) => {
        let raw = ''
        res.on('data', (chunk: any) => { raw += chunk })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} })
          }
        })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })

    expect(response.status).toBe(404)
    expect((response.body as Record<string, unknown>).error).toBeTruthy()
    const error = (response.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('NOT_FOUND')
  })

  it('missing org_id parameter returns 400', async () => {
    const shopifyOrder = {
      id: 'gid://shopify/Order/444444444',
      order_number: 1004,
    }

    const body = JSON.stringify(shopifyOrder)
    const hmac = createHmac('sha256', webhookSecret)
      .update(body, 'utf8')
      .digest('base64')

    const url = new URL(`/api/v1/integrations/shopify/webhook?shop_domain=${shopDomain}`, baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Hmac-Sha256': hmac,
          'Content-Length': Buffer.byteLength(body),
        },
      }

      const req = http.request(options, (res: any) => {
        let raw = ''
        res.on('data', (chunk: any) => { raw += chunk })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) })
          } catch {
            resolve({ status: res.statusCode ?? 0, body: {} })
          }
        })
      })

      req.on('error', reject)
      req.write(body)
      req.end()
    })

    expect(response.status).toBe(400)
    expect((response.body as Record<string, unknown>).error).toBeTruthy()
    const error = (response.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('MISSING_PARAMS')
  })

  it('stops server and cleans up', async () => {
    // Clean up test data
    await query(`DELETE FROM shopify_connections WHERE org_id = $1`, [orgId])
    await query(`DELETE FROM organizations WHERE id = $1`, [orgId])

    await stopTestServer()
    expect(true).toBe(true)
  })
})
