// tests/integration/shipments.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Shipments Integration', () => {
  let token = ''
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000099'

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Shipments Test Org', `shipments-test-${Date.now()}`)
    const user = await createUser(org.id, `shipments${Date.now()}@example.com`, 'Password123!', 'Shipments Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('GET /api/v1/shipments without auth returns 401', async () => {
    const res = await request('GET', '/api/v1/shipments')
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/shipments without auth returns 401', async () => {
    const res = await request('POST', '/api/v1/shipments', {
      body: { orderIds: ['id1'], destinationAddress: {} },
    })
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/shipments returns 200 with shipments and total', async () => {
    const res = await request('GET', '/api/v1/shipments', { token })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(Array.isArray(data.shipments)).toBe(true)
    expect(typeof data.total).toBe('number')
  })

  it('POST /api/v1/shipments missing orderIds returns 400', async () => {
    const res = await request('POST', '/api/v1/shipments', {
      token,
      body: { destinationAddress: { street: '1 Main St' } },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/v1/shipments missing destinationAddress returns 400', async () => {
    const res = await request('POST', '/api/v1/shipments', {
      token,
      body: { orderIds: ['order-id-1'] },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('GET /api/v1/shipments/:id with unknown ID returns 404', async () => {
    const res = await request('GET', `/api/v1/shipments/${UNKNOWN_ID}`, { token })
    expect(res.status).toBe(404)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
