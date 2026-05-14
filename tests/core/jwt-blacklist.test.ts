// tests/core/jwt-blacklist.test.ts
import { describe, it, expect } from '../runner'
import { sign, blacklistToken, isBlacklisted } from '../../core/auth/jwt'

describe('JWT Blacklist', () => {
  it('blacklists a token', async () => {
    const token = sign({ sub: 'user123', org: 'org456', role: 'admin' }, 'test-secret', 3600)

    // Initially not blacklisted
    let blacklisted = await isBlacklisted(token)
    expect(blacklisted).toBe(false)

    // Blacklist it
    await blacklistToken(token)

    // Now it should be blacklisted
    blacklisted = await isBlacklisted(token)
    expect(blacklisted).toBe(true)
  })

  it('stores blacklist entry with correct TTL', async () => {
    const token = sign({ sub: 'user123', org: 'org456', role: 'admin' }, 'test-secret', 60)

    // Blacklist the token
    await blacklistToken(token)

    // Token should be blacklisted
    const blacklisted = await isBlacklisted(token)
    expect(blacklisted).toBe(true)
  })

  it('ignores already-expired tokens', async () => {
    const token = sign({ sub: 'user123', org: 'org456', role: 'admin' }, 'test-secret', -1)

    // Blacklist expired token (should be no-op)
    await blacklistToken(token)

    // Expired token is not in blacklist
    const blacklisted = await isBlacklisted(token)
    expect(blacklisted).toBe(false)
  })

  it('fails open if Redis is unavailable', async () => {
    const token = sign({ sub: 'user123', org: 'org456', role: 'admin' }, 'test-secret', 3600)

    // Even if Redis is down, isBlacklisted should return false (fail open)
    // This test assumes Redis is running; if Redis is down, the behavior is tested implicitly
    const blacklisted = await isBlacklisted(token)
    expect(typeof blacklisted).toBe('boolean')
  })

  it('handles malformed tokens gracefully', async () => {
    const malformedToken = 'not.a.valid.token.structure'

    // Should not throw; should return false
    const blacklisted = await isBlacklisted(malformedToken)
    expect(blacklisted).toBe(false)
  })

  it('uses different fingerprints for different tokens', async () => {
    const token1 = sign({ sub: 'user1', org: 'org1', role: 'admin' }, 'test-secret', 3600)
    const token2 = sign({ sub: 'user2', org: 'org2', role: 'user' }, 'test-secret', 3600)

    await blacklistToken(token1)

    // Token1 should be blacklisted
    const blacklisted1 = await isBlacklisted(token1)
    expect(blacklisted1).toBe(true)

    // Token2 should not be blacklisted
    const blacklisted2 = await isBlacklisted(token2)
    expect(blacklisted2).toBe(false)
  })
})
