import { readFileSync } from 'fs'
import { hashPassword } from '../core/auth/password'
import { query, closePool } from '../core/db/pool'

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

const hash = hashPassword('TestPassword123!')
query(
  `INSERT INTO users (id, org_id, email, password_hash, name, role)
   VALUES ('00000000-0000-0000-0000-000000000002',
           '00000000-0000-0000-0000-000000000001',
           'admin@test-org.com', $1, 'Test Admin', 'admin')
   ON CONFLICT (id) DO NOTHING`,
  [hash]
).then(() => {
  console.log('Test user seeded: admin@test-org.com / TestPassword123!')
  return closePool()
}).then(() => process.exit(0))
