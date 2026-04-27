// tests/integration/fraud.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Fraud Integration', () => {
  let token = ''

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Fraud Test Org', `fraud-test-${Date.now()}`)
    const user = await createUser(org.id, `fraud${Date.now()}@example.com`, 'Password123!', 'Fraud Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('POST /api/v1/fraud/detect without auth returns 401', async () => {
    const res = await request('POST', '/api/v1/fraud/detect', {
      body: { metric: 'orders_per_hour', value: 42 },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/fraud/detect with valid metric + value returns 200 with isAnomaly boolean', async () => {
    const res = await request('POST', '/api/v1/fraud/detect', {
      token,
      body: { metric: 'orders_per_hour', value: 42 },
    })
    // 200 is expected; baseline may not exist but detectAnomaly should still return a result
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const result = data.result as Record<string, unknown>
    expect(typeof result.isAnomaly).toBe('boolean')
  })

  it('POST /api/v1/fraud/detect missing metric returns 400', async () => {
    const res = await request('POST', '/api/v1/fraud/detect', {
      token,
      body: { value: 42 },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/v1/fraud/baseline/train with valid body returns 200', async () => {
    const res = await request('POST', '/api/v1/fraud/baseline/train', {
      token,
      body: {
        metric: 'orders_per_hour',
        values: [10, 12, 15, 11, 13, 14, 10, 16, 12, 11],
      },
    })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(typeof data.baseline).toBe('object')
  })

  it('POST /api/v1/fraud/baseline/train with empty values returns 400', async () => {
    const res = await request('POST', '/api/v1/fraud/baseline/train', {
      token,
      body: { metric: 'orders_per_hour', values: [] },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('GET /api/v1/fraud/baseline/nonexistent_metric_xyz returns 404', async () => {
    const res = await request('GET', '/api/v1/fraud/baseline/nonexistent_metric_xyz', { token })
    expect(res.status).toBe(404)
  })

  it('POST /api/v1/fraud/cusum with valid body returns 200 with results array', async () => {
    const res = await request('POST', '/api/v1/fraud/cusum', {
      token,
      body: {
        mean: 10,
        sigma: 2,
        observations: [10, 11, 10, 12, 10, 25, 28, 30],
      },
    })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(Array.isArray(data.results)).toBe(true)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
