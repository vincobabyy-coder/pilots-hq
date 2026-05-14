import { describe, it, expect } from '../runner'
import { sanitizeLogContext } from '../../core/logger/sanitize'

describe('LogSanitize', () => {
  it('redacts password key', () => {
    const result = sanitizeLogContext({ password: 'mysecret', email: 'a@b.com' })
    expect(result.password).toBe('[REDACTED]')
    expect(result.email).toBe('a@b.com')
  })

  it('redacts Authorization header', () => {
    const result = sanitizeLogContext({ Authorization: 'Bearer eyJ...' })
    expect(result.Authorization).toBe('[REDACTED]')
  })

  it('redacts refreshToken key', () => {
    const result = sanitizeLogContext({ refreshToken: 'abc123' })
    expect(result.refreshToken).toBe('[REDACTED]')
  })

  it('redacts api_key key', () => {
    const result = sanitizeLogContext({ api_key: 'key-secret' })
    expect(result.api_key).toBe('[REDACTED]')
  })

  it('passes through non-sensitive keys unchanged', () => {
    const result = sanitizeLogContext({ userId: 'user-1', orgId: 'org-2', method: 'POST' })
    expect(result.userId).toBe('user-1')
    expect(result.orgId).toBe('org-2')
    expect(result.method).toBe('POST')
  })

  it('recursively sanitizes nested objects', () => {
    const result = sanitizeLogContext({
      user: { token: 'secret-token', name: 'Alice' },
      request: { authorization: 'Bearer xyz', path: '/api' },
    })
    expect((result.user as Record<string, unknown>).token).toBe('[REDACTED]')
    expect((result.user as Record<string, unknown>).name).toBe('Alice')
    expect((result.request as Record<string, unknown>).authorization).toBe('[REDACTED]')
    expect((result.request as Record<string, unknown>).path).toBe('/api')
  })

  it('passes arrays through unchanged (not recursed into)', () => {
    const arr = [{ password: 'secret' }, 'hello']
    const result = sanitizeLogContext({ items: arr })
    expect(result.items).toEqual(arr)
  })

  it('handles null values without crashing', () => {
    const result = sanitizeLogContext({ foo: null, bar: undefined })
    expect(result.foo).toBeNull()
  })

  it('handles empty object', () => {
    const result = sanitizeLogContext({})
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('redacts secret key', () => {
    const result = sanitizeLogContext({ secret: 'my-webhook-secret' })
    expect(result.secret).toBe('[REDACTED]')
  })
})
