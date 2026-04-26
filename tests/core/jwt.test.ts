import { describe, it, expect } from '../runner'
import { sign, verify } from '../../core/auth/jwt'

const SECRET = 'test-secret-at-least-32-characters-long'

describe('JWT', () => {
  it('sign produces a 3-part dot-separated token', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
  })

  it('verify returns the original payload', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    const payload = verify(token, SECRET)
    expect(payload.sub).toBe('user1')
    expect(payload.org).toBe('org1')
    expect(payload.role).toBe('admin')
  })

  it('verify throws on wrong secret', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    expect(() => verify(token, 'wrong-secret')).toThrow('Invalid token signature')
  })

  it('verify throws on tampered payload', () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, 3600)
    const parts = token.split('.')
    // Replace middle (payload) with tampered version
    const tampered = parts[0] + '.' + Buffer.from('{"sub":"hacker"}').toString('base64url') + '.' + parts[2]
    expect(() => verify(tampered, SECRET)).toThrow('Invalid token signature')
  })

  it('verify throws on expired token', async () => {
    const token = sign({ sub: 'user1', org: 'org1', role: 'admin' }, SECRET, -1)
    expect(() => verify(token, SECRET)).toThrow('Token expired')
  })
})
