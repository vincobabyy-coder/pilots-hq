import { describe, it, expect } from '../runner'
import { Router } from '../../core/http/router'
import { PilotsRequest, PilotsResponse } from '../../core/http/types'

function mockReq(method: string, path: string): PilotsRequest {
  return { method, url: path, path, query: {}, params: {}, headers: {}, body: null, requestId: 'r1' }
}

describe('Router', () => {
  it('matches a static route', async () => {
    const router = new Router()
    let called = false
    router.get('/health', async (_req, _res) => { called = true })
    const match = router.match('GET', '/health')
    expect(match).toBeTruthy()
    if (match) await match.handler(mockReq('GET', '/health'), {} as PilotsResponse)
    expect(called).toBe(true)
  })

  it('returns null for unmatched route', () => {
    const router = new Router()
    router.get('/health', async () => {})
    expect(router.match('GET', '/unknown')).toBeNull()
  })

  it('extracts path params', () => {
    const router = new Router()
    router.get('/users/:id/orders/:orderId', async () => {})
    const match = router.match('GET', '/users/abc123/orders/xyz')
    expect(match).toBeTruthy()
    if (match) {
      expect(match.params['id']).toBe('abc123')
      expect(match.params['orderId']).toBe('xyz')
    }
  })

  it('distinguishes HTTP methods', () => {
    const router = new Router()
    router.get('/items', async () => {})
    router.post('/items', async () => {})
    expect(router.match('GET', '/items')).toBeTruthy()
    expect(router.match('POST', '/items')).toBeTruthy()
    expect(router.match('DELETE', '/items')).toBeNull()
  })

  it('supports nested routers with prefix', () => {
    const v1 = new Router()
    v1.get('/orders', async () => {})
    const main = new Router()
    main.use('/api/v1', v1)
    expect(main.match('GET', '/api/v1/orders')).toBeTruthy()
    expect(main.match('GET', '/api/v2/orders')).toBeNull()
  })
})
