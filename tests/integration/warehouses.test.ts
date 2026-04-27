// tests/integration/warehouses.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'

describe('Warehouses Integration', () => {
  let token = ''
  const FAKE_UUID = '00000000-0000-0000-0000-000000000000'
  const INVALID_ID = 'not-a-uuid'

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('WH Test Org', `wh-test-${Date.now()}`)
    const user = await createUser(org.id, `wh${Date.now()}@example.com`, 'Password123!', 'WH Tester', 'admin')
    const rows = await (await import('../../core/db/pool')).query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1', [user.id]
    )
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('GET /api/v1/warehouses without auth returns 401', async () => {
    const res = await request('GET', '/api/v1/warehouses')
    expect(res.status).toBe(401)
  })

  it('GET /api/v1/warehouses with valid JWT returns 200 with warehouses array', async () => {
    const res = await request('GET', '/api/v1/warehouses', { token })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(Array.isArray(data.warehouses)).toBe(true)
  })

  it('GET /api/v1/warehouses/:id with invalid UUID format returns 400', async () => {
    const res = await request('GET', `/api/v1/warehouses/${INVALID_ID}`, { token })
    expect(res.status).toBe(400)
  })

  it('GET /api/v1/warehouses/:id with valid UUID that does not exist returns 404', async () => {
    const res = await request('GET', `/api/v1/warehouses/${FAKE_UUID}`, { token })
    expect(res.status).toBe(404)
  })

  it('GET /api/v1/warehouses/:id/inventory with non-existent warehouse returns 404', async () => {
    const res = await request('GET', `/api/v1/warehouses/${FAKE_UUID}/inventory`, { token })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/v1/warehouses/:id/inventory/:sku with spaces in SKU returns 400', async () => {
    const res = await request('PATCH', `/api/v1/warehouses/${FAKE_UUID}/inventory/bad%20sku`, { token, body: { quantity: 5 } })
    expect(res.status).toBe(400)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
