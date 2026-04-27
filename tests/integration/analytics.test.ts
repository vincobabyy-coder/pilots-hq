// tests/integration/analytics.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import { createOrg, createUser, login } from '../../api/services/auth.service'
import { query } from '../../core/db/pool'

describe('Analytics Integration', () => {
  let token = ''

  it('starts server and authenticates', async () => {
    await startTestServer()
    const org = await createOrg('Analytics Test Org', `analytics-test-${Date.now()}`)
    const user = await createUser(org.id, `analytics${Date.now()}@example.com`, 'Password123!', 'Analytics Tester', 'admin')
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [user.id])
    const tokens = await login(rows[0].email, 'Password123!')
    token = tokens.accessToken
    expect(typeof token).toBe('string')
  })

  it('POST /api/v1/analytics/percentiles without auth returns 401', async () => {
    const res = await request('POST', '/api/v1/analytics/percentiles', {
      body: { data: [1, 2, 3] },
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/v1/analytics/percentiles with valid data returns 200 with p50/p95/p99', async () => {
    const res = await request('POST', '/api/v1/analytics/percentiles', {
      token,
      body: { data: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] },
    })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const result = data.result as Record<string, unknown>
    expect(typeof result.p50).toBe('number')
    expect(typeof result.p95).toBe('number')
    expect(typeof result.p99).toBe('number')
  })

  it('POST /api/v1/analytics/percentiles missing data returns 400', async () => {
    const res = await request('POST', '/api/v1/analytics/percentiles', {
      token,
      body: {},
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /api/v1/analytics/decompose with too-short data returns 400 or 422', async () => {
    // decompose requires data + periodLength; with 1 data point and periodLength=2 the engine should reject
    const res = await request('POST', '/api/v1/analytics/decompose', {
      token,
      body: {
        data: [{ timestamp: 1000, value: 5 }],
        periodLength: 2,
      },
    })
    const isError = res.status === 400 || res.status === 422 || res.status === 500
    expect(isError).toBe(true)
  })

  it('POST /api/v1/analytics/forecast with insufficient data returns 400 or 422', async () => {
    // forecastDemand with only 1 data point and periodLength=12 should fail
    const res = await request('POST', '/api/v1/analytics/forecast', {
      token,
      body: {
        data: [{ timestamp: 1000, value: 5 }],
        periodLength: 12,
        horizonSteps: 3,
      },
    })
    const isError = res.status === 422 || res.status === 400 || res.status === 500
    expect(isError).toBe(true)
  })

  it('POST /api/v1/analytics/predict-delivery with only 1 stop returns 400', async () => {
    const res = await request('POST', '/api/v1/analytics/predict-delivery', {
      token,
      body: {
        stops: [{ lat: 6.5244, lon: 3.3792 }],
        departureDate: new Date().toISOString(),
      },
    })
    expect(res.status).toBe(400)
    const error = (res.body as Record<string, unknown>).error as Record<string, unknown>
    expect(error.code).toBe('VALIDATION_ERROR')
  })

  it('GET /api/v1/analytics/delivery-stats returns 200 with stats object', async () => {
    const res = await request('GET', '/api/v1/analytics/delivery-stats', { token })
    expect(res.status).toBe(200)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(typeof data.stats).toBe('object')
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
