import { readFileSync } from 'fs'
import { migrate } from './migrator'
import { closePool } from './pool'

// Load .env manually (no dotenv package)
function loadEnv(): void {
  try {
    const env = readFileSync('.env', 'utf8')
    for (const line of env.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIndex = trimmed.indexOf('=')
      if (eqIndex === -1) continue
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // No .env file — rely on environment variables
  }
}

loadEnv()

migrate()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
