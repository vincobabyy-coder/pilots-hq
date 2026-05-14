// tests/integration/jwt-logout.test.ts
import { describe, it, expect } from '../runner'
import { startTestServer, stopTestServer, request } from './helpers/server'

describe('JWT Logout and Blacklist', () => {
  it('starts server', async () => {
    await startTestServer()
    expect(true).toBe(true)
  })

  it('logs out and blacklists token', async () => {
    // Login to get a token
    const loginRes = await request<any>('POST', '/api/v1/auth/login', {
      body: {
        email: 'admin@example.com',
        password: 'Pass123!',
      },
    })

    expect(loginRes.status).toBe(200)
    const accessToken = (loginRes.body as any).data.accessToken as string
    expect(accessToken).toBeTruthy()

    // Logout
    const logoutRes = await request<any>('POST', '/api/v1/auth/logout', {
      token: accessToken,
    })

    expect(logoutRes.status).toBe(200)
    expect((logoutRes.body as any).data.loggedOut).toBe(true)
  })

  it('rejects blacklisted token', async () => {
    // Login to get a token
    const loginRes = await request<any>('POST', '/api/v1/auth/login', {
      body: {
        email: 'admin@example.com',
        password: 'Pass123!',
      },
    })

    const accessToken = (loginRes.body as any).data.accessToken as string

    // Logout (blacklist the token)
    await request<any>('POST', '/api/v1/auth/logout', {
      token: accessToken,
    })

    // Try to use the blacklisted token
    const meRes = await request<any>('GET', '/api/v1/auth/me', {
      token: accessToken,
    })

    expect(meRes.status).toBe(401)
    expect((meRes.body as any).error.code).toBe('TOKEN_REVOKED')
  })

  it('requires authentication for logout', async () => {
    const res = await request<any>('POST', '/api/v1/auth/logout', {})

    expect(res.status).toBe(401)
    expect((res.body as any).error.code).toBe('TOKEN_MISSING')
  })

  it('stops server', async () => {
    await stopTestServer()
    expect(true).toBe(true)
  })
})
