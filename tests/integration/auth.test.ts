import { describe, it, expect } from '../runner'
import { login, refresh, getMe, createOrg, createUser } from '../../api/services/auth.service'
import { query, closePool } from '../../core/db/pool'
import { readFileSync } from 'fs'

function loadEnv(): void {
  try {
    const env = readFileSync('.env', 'utf8')
    for (const line of env.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const k = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim()
      if (!process.env[k]) process.env[k] = val
    }
  } catch { /* ignore */ }
}
loadEnv()

describe('Auth Integration', () => {
  let orgId: string
  let userId: string

  it('creates an org', async () => {
    const org = await createOrg('Integration Test Org', `int-test-${Date.now()}`)
    expect(typeof org.id).toBe('string')
    orgId = org.id
  })

  it('creates a user in the org', async () => {
    const user = await createUser(orgId, `test${Date.now()}@example.com`, 'Password123!', 'Tester', 'admin')
    expect(typeof user.id).toBe('string')
    userId = user.id
  })

  it('login returns access and refresh tokens', async () => {
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
    const email = rows[0].email
    const tokens = await login(email, 'Password123!')
    expect(typeof tokens.accessToken).toBe('string')
    expect(typeof tokens.refreshToken).toBe('string')
    expect(tokens.expiresIn).toBe(3600)
  })

  it('login throws on wrong password', async () => {
    const rows = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
    const email = rows[0].email
    let threw = false
    try { await login(email, 'wrongpassword') } catch { threw = true }
    expect(threw).toBe(true)
  })

  it('getMe returns user details', async () => {
    const user = await getMe(userId)
    expect(user.id).toBe(userId)
    expect(user.role).toBe('admin')
  })
})
