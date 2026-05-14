// tests/integration/stripe.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, baseUrl } from './helpers/server'
import { createOrg } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'
import { createHmac } from 'crypto'

describe('Stripe Integration', () => {
  let orgId = ''
  const webhookSecret = 'whsec_test_secret_123'

  it('starts server and creates test data', async () => {
    // Set the Stripe webhook secret for this test session
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret

    await startTestServer()

    // Create a test organization
    const org = await createOrg('Stripe Test Org', `stripe-test-${Date.now()}`)
    orgId = org.id

    // Insert a billing subscription record
    await query(
      `INSERT INTO billing_subscriptions (org_id, stripe_customer_id, stripe_subscription_id, tier, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [orgId, 'cus_test_123', 'sub_test_456', 'starter', 'active']
    )

    expect(orgId).toBeTruthy()
    expect(typeof orgId).toBe('string')
  })

  it('valid HMAC signature processes invoice.paid event', async () => {
    const stripeEvent = {
      id: 'evt_test_001',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_test_001',
          subscription: 'sub_test_456',
          status: 'paid',
        },
      },
    }

    const body = JSON.stringify(stripeEvent)
    const timestamp = Math.floor(Date.now() / 1000)
    const signedContent = `${timestamp}.${body}`
    const hmac = createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex')
    const sig = `t=${timestamp},v1=${hmac}`

    // Make raw HTTP request to test webhook endpoint
    const url = new URL('/api/v1/integrations/stripe/webhook', baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stripe-Signature': sig,
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
    expect(data.eventId).toBe('evt_test_001')
    expect(data.eventType).toBe('invoice.paid')

    // Verify subscription status was updated
    const rows = await query<{ status: string }>(
      `SELECT status FROM billing_subscriptions WHERE stripe_subscription_id = $1`,
      ['sub_test_456']
    )
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('active')
  })

  it('valid HMAC signature processes payment_intent.payment_failed event', async () => {
    const stripeEvent = {
      id: 'evt_test_002',
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_test_001',
          customer: 'cus_test_123',
          status: 'requires_payment_method',
        },
      },
    }

    const body = JSON.stringify(stripeEvent)
    const timestamp = Math.floor(Date.now() / 1000)
    const signedContent = `${timestamp}.${body}`
    const hmac = createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex')
    const sig = `t=${timestamp},v1=${hmac}`

    const url = new URL('/api/v1/integrations/stripe/webhook', baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stripe-Signature': sig,
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
    expect(data.eventId).toBe('evt_test_002')
    expect(data.eventType).toBe('payment_intent.payment_failed')

    // Verify subscription status was updated to past_due
    const rows = await query<{ status: string }>(
      `SELECT status FROM billing_subscriptions WHERE stripe_customer_id = $1`,
      ['cus_test_123']
    )
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('past_due')
  })

  it('invalid HMAC signature returns 401', async () => {
    const stripeEvent = {
      id: 'evt_test_003',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_test_002',
          subscription: 'sub_test_456',
        },
      },
    }

    const body = JSON.stringify(stripeEvent)
    // Use a current timestamp with invalid signature (compute with wrong secret)
    const timestamp = Math.floor(Date.now() / 1000)
    const signedContent = `${timestamp}.${body}`
    const wrongSecret = 'wrong_secret_key_123'
    const hmac = createHmac('sha256', wrongSecret)
      .update(signedContent)
      .digest('hex')
    const invalidSig = `t=${timestamp},v1=${hmac}`

    const url = new URL('/api/v1/integrations/stripe/webhook', baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stripe-Signature': invalidSig,
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

  it('stale timestamp returns 401', async () => {
    const stripeEvent = {
      id: 'evt_test_004',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_test_003',
          subscription: 'sub_test_456',
        },
      },
    }

    const body = JSON.stringify(stripeEvent)
    // Use a timestamp from 10 minutes ago (> 5 minute replay protection window)
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600
    const signedContent = `${staleTimestamp}.${body}`
    const hmac = createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex')
    const sig = `t=${staleTimestamp},v1=${hmac}`

    const url = new URL('/api/v1/integrations/stripe/webhook', baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stripe-Signature': sig,
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
    expect(error.code).toBe('STALE_TIMESTAMP')
  })

  it('missing X-Stripe-Signature header returns error', async () => {
    const stripeEvent = {
      id: 'evt_test_005',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'in_test_004',
          subscription: 'sub_test_456',
        },
      },
    }

    const body = JSON.stringify(stripeEvent)
    const url = new URL('/api/v1/integrations/stripe/webhook', baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
  })

  it('unhandled event type is acknowledged without processing', async () => {
    const stripeEvent = {
      id: 'evt_test_006',
      type: 'charge.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'ch_test_001',
        },
      },
    }

    const body = JSON.stringify(stripeEvent)
    const timestamp = Math.floor(Date.now() / 1000)
    const signedContent = `${timestamp}.${body}`
    const hmac = createHmac('sha256', webhookSecret)
      .update(signedContent)
      .digest('hex')
    const sig = `t=${timestamp},v1=${hmac}`

    const url = new URL('/api/v1/integrations/stripe/webhook', baseUrl())

    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const http = require('http')
      const options = {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stripe-Signature': sig,
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
    const data = (response.body as Record<string, unknown>).data as Record<string, unknown>
    expect(data.received).toBe(true)
    expect(data.eventType).toBe('charge.succeeded')
  })

  it('stops server and cleans up', async () => {
    // Clean up test data
    await query(`DELETE FROM billing_subscriptions WHERE org_id = $1`, [orgId])
    await query(`DELETE FROM organizations WHERE id = $1`, [orgId])

    await stopTestServer()
    expect(true).toBe(true)
  })
})
