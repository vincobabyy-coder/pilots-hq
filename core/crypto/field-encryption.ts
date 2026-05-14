import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import { query } from '../db/pool'
import { logger } from '../logger/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): Buffer {
  const padded = str + '==='.slice((str.length + 3) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Encrypt a sensitive string field with AES-256-GCM.
 * Returns a dot-separated string: base64url(iv).base64url(ciphertext).base64url(authTag)
 */
export function encryptField(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`)
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${base64urlEncode(iv)}.${base64urlEncode(ct)}.${base64urlEncode(authTag)}`
}

/**
 * Decrypt a field encrypted by encryptField.
 * Throws if the format is invalid or the GCM auth tag does not match.
 */
export function decryptField(encoded: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes, got ${key.length}`)
  }
  const parts = encoded.split('.')
  if (parts.length !== 3) {
    throw new Error(`Invalid encrypted field format: expected 3 parts, got ${parts.length}`)
  }
  const [ivPart, ctPart, tagPart] = parts
  const iv = base64urlDecode(ivPart)
  const ct = base64urlDecode(ctPart)
  const authTag = base64urlDecode(tagPart)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
  return plaintext.toString('utf8')
}

/**
 * Load the encryption key from ENCRYPTION_KEY env var.
 * Must be a 64-character hex string (32 bytes).
 * Called at runtime, not at module load, so tests that don't set this env var still import cleanly.
 */
export function getEncryptionKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }
  if (hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * One-time data migration: encrypt any rows in organizations that still have plaintext
 * values in api_key_plaintext or webhook_secret_plaintext columns (from migration 022).
 * Safe to call multiple times — skips already-encrypted rows.
 */
export async function migrateEncryptFields(): Promise<void> {
  // Check if the _plaintext columns exist (migration 022 may not have run yet)
  const colCheck = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'organizations' AND column_name IN ('api_key_plaintext', 'webhook_secret_plaintext')`
  )
  const cols = colCheck.map(r => r.column_name)
  if (cols.length === 0) {
    // Migration 022 hasn't added the plaintext columns — nothing to migrate
    return
  }

  const key = getEncryptionKey()

  if (cols.includes('api_key_plaintext')) {
    const rows = await query<{ id: string; api_key_plaintext: string }>(
      `SELECT id, api_key_plaintext FROM organizations
       WHERE api_key_plaintext IS NOT NULL AND api_key_encrypted IS NULL`
    )
    for (const row of rows) {
      const encrypted = encryptField(row.api_key_plaintext, key)
      await query(
        'UPDATE organizations SET api_key_encrypted = $1 WHERE id = $2',
        [encrypted, row.id]
      )
    }
    if (rows.length > 0) {
      logger.info('Encrypted api_key fields', { count: rows.length })
    }
  }

  if (cols.includes('webhook_secret_plaintext')) {
    const rows = await query<{ id: string; webhook_secret_plaintext: string }>(
      `SELECT id, webhook_secret_plaintext FROM organizations
       WHERE webhook_secret_plaintext IS NOT NULL AND webhook_secret_encrypted_v2 IS NULL`
    )
    for (const row of rows) {
      const encrypted = encryptField(row.webhook_secret_plaintext, key)
      await query(
        'UPDATE organizations SET webhook_secret_encrypted_v2 = $1 WHERE id = $2',
        [encrypted, row.id]
      )
    }
    if (rows.length > 0) {
      logger.info('Encrypted webhook_secret fields', { count: rows.length })
    }
  }
}

/**
 * Fingerprint a string (e.g., a JWT token) for use as a Redis key.
 * Returns first 32 hex chars of SHA-256 — enough to uniquely identify without storing the token.
 */
export function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32)
}
