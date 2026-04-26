import { describe, it, expect } from '../runner'
import { hashPassword, verifyPassword } from '../../core/auth/password'

describe('Password', () => {
  it('hashPassword returns salt:hash format', () => {
    const hash = hashPassword('secret123')
    const parts = hash.split(':')
    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBe(128) // 64 bytes hex = 128 chars
    expect(parts[1].length).toBe(128)
  })

  it('two hashes of same password are different (different salts)', () => {
    const h1 = hashPassword('secret123')
    const h2 = hashPassword('secret123')
    expect(h1 === h2).toBe(false)
  })

  it('verifyPassword returns true for correct password', () => {
    const hash = hashPassword('mypassword')
    expect(verifyPassword('mypassword', hash)).toBe(true)
  })

  it('verifyPassword returns false for wrong password', () => {
    const hash = hashPassword('mypassword')
    expect(verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('verifyPassword returns false for malformed stored value', () => {
    expect(verifyPassword('any', 'notahash')).toBe(false)
  })
})
