// tests/integration/drivers.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Drivers Integration', () => {
  let token = ''
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000099'

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Drivers Test Org', `drivers-test-${Date.now()}`)
    const user = await createUser(org.id, `drivers${Date.now()}@example.com`, 'Password123!', 'Drivers Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('PATCH /api/v1/drivers/:id/location without auth returns 401', async () => {
    const res = await request('PATCH', `/api/v1/drivers/${UNKNOWN_ID}/location`, {
      body: { lat: 6.5244, lon: 3.3792 },
    })
    expect(res.status).toBe(401)
  })

  it('PATCH /api/v1/drivers/:id/location with unknown driver UUID returns 404 or 400', async () => {
    const res = await request('PATCH', `/api/v1/drivers/${UNKNOWN_ID}/location`, {
      token,
      body: { lat: 6.5244, lon: 3.3792 },
    })
    expect(res.status === 404 || res.status === 400).toBe(true)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
