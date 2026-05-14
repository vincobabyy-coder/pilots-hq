// tests/integration/health-security.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'
import Redis from 'ioredis'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
  }
  return redis
}

describe('Health Security Endpoint', () => {
  it('starts server', async () => {
    await startTestServer()
    expect(true).toBe(true)
  })

  it('returns security metrics endpoint', async () => {
    const response = await request<any>('GET', '/api/v1/health/security')

    expect(response.status).toBe(200)
    expect((response.body as any).data).toBeTruthy()
    expect(((response.body as any).data as any).securityEvents).toBeTruthy()
  })

  it('returns security event shape', async () => {
    const response = await request<any>('GET', '/api/v1/health/security')

    const events = ((response.body as any).data as any).securityEvents
    expect(typeof events.failedLoginsLastHour).toBe('number')
    expect(typeof events.rateLimitHitsLastHour).toBe('number')
    expect(typeof events.lockedAccountCount).toBe('number')
  })

  it('increments failed logins counter on failed login attempt', async () => {
    // Clear the counter first
    try {
      const r = getRedis()
      await r.del('pilots:metrics:failed_logins:1h')
    } catch {
      // ignore
    }

    // Attempt login with wrong password (will fail)
    await request('POST', '/api/v1/auth/login', {
      body: {
        email: 'nonexistent@example.com',
        password: 'wrongpass',
      },
    })

    // Check security health endpoint shows incremented counter
    const response = await request<any>('GET', '/api/v1/health/security')

    const events = ((response.body as any).data as any).securityEvents
    expect(events.failedLoginsLastHour > 0).toBe(true)
  })

  it('tracks multiple failed logins', async () => {
    try {
      const r = getRedis()
      await r.del('pilots:metrics:failed_logins:1h')
    } catch {
      // ignore
    }

    // Attempt 3 failed logins
    for (let i = 0; i < 3; i++) {
      await request('POST', '/api/v1/auth/login', {
        body: {
          email: 'test@example.com',
          password: 'wrongpass',
        },
      })
    }

    const response = await request<any>('GET', '/api/v1/health/security')
    const events = ((response.body as any).data as any).securityEvents

    expect(events.failedLoginsLastHour >= 3).toBe(true)
  })

  it('returns zero counters initially', async () => {
    // Clean up all metrics
    try {
      const r = getRedis()
      await r.del('pilots:metrics:failed_logins:1h')
      await r.del('pilots:metrics:rate_limit_hits:1h')
    } catch {
      // ignore
    }

    // Request health endpoint
    const response = await request<any>('GET', '/api/v1/health/security')
    const events = ((response.body as any).data as any).securityEvents

    expect(events.failedLoginsLastHour <= 0).toBe(true)
    expect(events.rateLimitHitsLastHour <= 0).toBe(true)
  })

  it('stops server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
