// tests/integration/billing.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Billing Integration', () => {
  let token = ''

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Billing Test Org', `billing-test-${Date.now()}`)
    const user = await createUser(org.id, `billing${Date.now()}@example.com`, 'Password123!', 'Billing Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('POST /api/v1/billing/compute without auth returns 401', async () => {
    const res = await request('POST', '/api/v1/billing/compute', {
      body: { tier: 'starter', shipmentCount: 10, routeCount: 5, warehouseCount: 2, apiCallCount: 1000, storageGb: 3, periodDays: 30 },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/billing/compute with valid body returns 200 with bill', async () => {
    const res = await request('POST', '/api/v1/billing/compute', {
      token,
      body: { tier: 'starter', shipmentCount: 50, routeCount: 10, warehouseCount: 2, apiCallCount: 5000, storageGb: 3, periodDays: 30 },
    })
    expect(res.status).toBe(200)
    const data = (res.body as any).data as any
    // Response shape: { bill: { totalCents, lineItems, ... }, auditId }
    expect(typeof data.bill).toBe('object')
    expect(typeof data.bill.totalCents).toBe('number')
    expect(Array.isArray(data.bill.lineItems)).toBe(true)
    expect(data.bill.lineItems.length > 0).toBe(true)
  })

  it('POST /api/v1/billing/forecast without auth returns 401', async () => {
    const res = await request('POST', '/api/v1/billing/forecast')
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/billing/forecast with valid body returns 200 with bill', async () => {
    const res = await request('POST', '/api/v1/billing/forecast', {
      token,
      body: { tier: 'growth', shipmentCount: 100, routeCount: 20, warehouseCount: 3, apiCallCount: 20000, storageGb: 10, periodDays: 30 },
    })
    expect(res.status).toBe(200)
    const data = (res.body as any).data as any
    // Response shape: { bill: { totalCents, lineItems, ... } }
    expect(typeof data.bill).toBe('object')
    expect(typeof data.bill.totalCents).toBe('number')
  })

  it('GET /api/v1/billing/history without auth returns 401', async () => {
    const res = await request('GET', '/api/v1/billing/history')
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/billing/history returns 200 with records array', async () => {
    const res = await request('GET', '/api/v1/billing/history', { token })
    expect(res.status).toBe(200)
    const data = (res.body as any).data as any
    // Response shape: { records: [...], pagination: { page, pageSize, total, totalPages } }
    expect(Array.isArray(data.records)).toBe(true)
    expect(typeof data.pagination).toBe('object')
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
