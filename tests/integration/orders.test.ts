// tests/integration/orders.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Orders Integration', () => {
  let token = ''
  const FAKE_UUID = '00000000-0000-0000-0000-000000000001'

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Orders Test Org', `orders-test-${Date.now()}`)
    const user = await createUser(org.id, `orders${Date.now()}@example.com`, 'Password123!', 'Orders Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('GET /api/v1/orders without auth returns 401', async () => {
    const res = await request('GET', '/api/v1/orders')
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/orders without auth returns 401', async () => {
    const res = await request('POST', '/api/v1/orders', {
      body: { orderNumber: 'ORD-001', destinationAddress: {}, items: [{ sku: 'SKU1', quantity: 1 }] },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/orders missing orderNumber returns 400 VALIDATION_ERROR', async () => {
    const res = await request('POST', '/api/v1/orders', {
      token,
      body: {
        destinationAddress: { street: '1 Main St' },
        items: [{ sku: 'SKU1', quantity: 1 }],
      },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/v1/orders missing destinationAddress returns 400 VALIDATION_ERROR', async () => {
    const res = await request('POST', '/api/v1/orders', {
      token,
      body: { orderNumber: 'ORD-001', items: [{ sku: 'SKU1', quantity: 1 }] },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/v1/orders missing items returns 400 VALIDATION_ERROR', async () => {
    const res = await request('POST', '/api/v1/orders', {
      token,
      body: { orderNumber: 'ORD-001', destinationAddress: { street: '1 Main St' } },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('GET /api/v1/orders returns 200 with orders/meta shape', async () => {
    const res = await request('GET', '/api/v1/orders', { token })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(Array.isArray(data.orders)).toBe(true)
    expect(typeof data.meta).toBe('object')
    const meta = data.meta as Record<string, unknown>
    expect(typeof meta.total).toBe('number')
    expect(typeof meta.limit).toBe('number')
    expect(typeof meta.offset).toBe('number')
  })

  it('GET /api/v1/orders/:id with non-existent UUID returns 404', async () => {
    const res = await request('GET', `/api/v1/orders/${FAKE_UUID}`, { token })
    expect(res.status).toBe(404)
  })

  it('POST /api/v1/orders/:id/allocate with non-existent UUID returns 404', async () => {
    const res = await request('POST', `/api/v1/orders/${FAKE_UUID}/allocate`, { token, body: {} })
    expect(res.status).toBe(404)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
