import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { query } from './pool'
import { logger } from '../logger/logger'
import { migrateEncryptFields } from '../crypto/field-encryption'

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

async function getApplied(): Promise<string[]> {
  try {
    const rows = await query<{ filename: string }>(
      'SELECT filename FROM _migrations ORDER BY id ASC'
    )
    return rows.map(r => r.filename)
  } catch {
    // _migrations table doesn't exist yet — will be created by first migration
    return []
  }
}

async function getMigrationFiles(): Promise<string[]> {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
}

export async function migrate(): Promise<void> {
  const applied = await getApplied()
  const files = await getMigrationFiles()
  const pending = files.filter(f => !applied.includes(f))

  if (pending.length === 0) {
    logger.info('Migrations: nothing to apply')
    return
  }

  for (const filename of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
    logger.info(`Applying migration: ${filename}`)
    // Run each migration in a single query execution
    await query(sql)
    await query(
      'INSERT INTO _migrations (filename) VALUES ($1)',
      [filename]
    )
    logger.info(`Applied: ${filename}`)
  }

  logger.info(`Migrations complete. Applied ${pending.length} migration(s).`)

  // Encrypt any plaintext sensitive fields left by migration 022.
  // Safe to call even if migration 022 hasn't run (function is a no-op then).
  if (process.env.ENCRYPTION_KEY) {
    try {
      await migrateEncryptFields()
    } catch (err) {
      logger.error('Field encryption migration failed — refusing to start', { error: (err as Error).message })
      process.exit(1)
    }
  }
}
