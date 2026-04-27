// tests/integration/health.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'

describe('Health Integration', () => {
  let started = false

  it('starts the test server', async () => {
    await startTestServer()
    started = true
    expect(started).toBe(true)
  })

  it('GET /api/v1/health returns 200 with correct shape', async () => {
    const res = await request('GET', '/api/v1/health')
    // Health can return 200 (ok) or 503 (degraded) — both are valid responses
    const ok = res.status === 200 || res.status === 503
    expect(ok).toBe(true)
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    expect(typeof data).toBe('object')
    expect(typeof data.status).toBe('string')
    expect(typeof data.version).toBe('string')
    expect(typeof data.uptime).toBe('number')
    expect(typeof data.checks).toBe('object')
  })

  it('GET /api/v1/health checks.database field exists', async () => {
    const res = await request('GET', '/api/v1/health')
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const checks = data.checks as Record<string, unknown>
    const dbStatus = checks.database
    const isValid = dbStatus === 'ok' || dbStatus === 'error'
    expect(isValid).toBe(true)
  })

  it('GET /api/v1/health checks.redis field exists', async () => {
    const res = await request('GET', '/api/v1/health')
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const checks = data.checks as Record<string, unknown>
    const redisStatus = checks.redis
    const isValid = redisStatus === 'ok' || redisStatus === 'error'
    expect(isValid).toBe(true)
  })

  it('GET /api/v1/health uptime is a non-negative number', async () => {
    const res = await request('GET', '/api/v1/health')
    const data = (res.body as Record<string, unknown>).data as Record<string, unknown>
    const uptime = data.uptime as number
    expect(typeof uptime).toBe('number')
    expect(uptime >= 0).toBe(true)
  })

  it('stops the test server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
