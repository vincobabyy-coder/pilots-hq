import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { query } from '../db/pool'
import { logger } from '../logger/logger'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

interface EncryptedFieldWithVersion {
  key_version: number
  iv: string
  ciphertext: string
  authTag: string
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): Buffer {
  const padded = str + '==='.slice((str.length + 3) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Key rotation manager: supports versioned encryption keys.
 * Allows rotating encryption keys without losing access to old data.
 *
 * PRODUCTION: Keys should come from AWS Secrets Manager or similar KMS.
 * DEV: Uses environment variables.
 */
export class KeyRotationManager {
  private keyVersions: Map<number, Buffer> = new Map()
  private currentVersion: number = 1

  constructor(keysFromEnv: Record<number, string>) {
    // Format: { "1": "old-key-hex", "2": "current-key-hex" }
    Object.entries(keysFromEnv).forEach(([version, keyHex]) => {
      if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error(`Key version ${version} is not a 64-char hex string`)
      }
      this.keyVersions.set(parseInt(version), Buffer.from(keyHex, 'hex'))
      this.currentVersion = Math.max(this.currentVersion, parseInt(version))
    })

    if (this.keyVersions.size === 0) {
      throw new Error('At least one encryption key must be provided')
    }
  }

  /**
   * Encrypt with current key version
   */
  encrypt(plaintext: string): string {
    const key = this.keyVersions.get(this.currentVersion)
    if (!key) {
      throw new Error(`Current key version ${this.currentVersion} not found`)
    }

    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    const data: EncryptedFieldWithVersion = {
      key_version: this.currentVersion,
      iv: base64urlEncode(iv),
      ciphertext: base64urlEncode(ct),
      authTag: base64urlEncode(authTag),
    }

    return JSON.stringify(data)
  }

  /**
   * Decrypt using version stored in field
   */
  decrypt(encrypted: string): string {
    let data: EncryptedFieldWithVersion
    try {
      data = JSON.parse(encrypted) as EncryptedFieldWithVersion
    } catch {
      throw new Error('Invalid encrypted field format: not valid JSON')
    }

    const key = this.keyVersions.get(data.key_version)
    if (!key) {
      throw new Error(`Key version ${data.key_version} not found in key store`)
    }

    const iv = base64urlDecode(data.iv)
    const ct = base64urlDecode(data.ciphertext)
    const authTag = base64urlDecode(data.authTag)

    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
    return plaintext.toString('utf8')
  }

  /**
   * Check if any keys need rotation (version is deprecated)
   */
  getDeprecatedVersions(retentionDays: number = 30): number[] {
    // Versions that are older than retentionDays can be deprecated
    // Implementation would depend on storing key version timestamps
    // For now, just return all versions except current
    return Array.from(this.keyVersions.keys()).filter(v => v !== this.currentVersion)
  }

  /**
   * Rotate a specific field to the current key version
   */
  async rotateField(
    table: string,
    idColumn: string,
    encryptedColumn: string,
    id: string
  ): Promise<void> {
    // Get old encrypted value
    const result = await query<{ [key: string]: string }>(
      `SELECT "${idColumn}", "${encryptedColumn}" FROM "${table}" WHERE "${idColumn}" = $1`,
      [id]
    )

    if (result.length === 0) {
      return // Nothing to rotate
    }

    const row = result[0]
    const encryptedValue = row[encryptedColumn]

    if (!encryptedValue) {
      return // Field is null
    }

    let data: EncryptedFieldWithVersion
    try {
      data = JSON.parse(encryptedValue) as EncryptedFieldWithVersion
    } catch {
      return // Can't parse, skip
    }

    if (data.key_version === this.currentVersion) {
      return // Already at current version
    }

    // Decrypt with old key, re-encrypt with new key
    const plaintext = this.decrypt(encryptedValue)
    const reencrypted = this.encrypt(plaintext)

    // Update database
    await query(
      `UPDATE "${table}" SET "${encryptedColumn}" = $1 WHERE "${idColumn}" = $2`,
      [reencrypted, id]
    )
  }

  /**
   * Background job: rotate all fields in a table from old version to current
   */
  async rotateTable(
    table: string,
    idColumn: string,
    encryptedColumn: string,
    fromVersion?: number
  ): Promise<{ rotated: number }> {
    const targetVersion = fromVersion || (this.currentVersion - 1)

    const oldRows = await query<{ [key: string]: string }>(
      `SELECT "${idColumn}" FROM "${table}"
       WHERE "${encryptedColumn}" IS NOT NULL
       AND "${encryptedColumn}" LIKE '%"key_version":${targetVersion}%'`,
      []
    )

    let rotated = 0
    for (const row of oldRows) {
      await this.rotateField(table, idColumn, encryptedColumn, row[idColumn])
      rotated++

      // Log every 100 rotations
      if (rotated % 100 === 0) {
        logger.info('Key rotation progress', { table, rotated })
      }
    }

    if (rotated > 0) {
      logger.info('Key rotation completed', { table, rotated, fromVersion: targetVersion })
    }

    return { rotated }
  }

  /**
   * Load keys from environment or KMS
   * DEVELOPMENT: ENCRYPTION_KEY_V1, ENCRYPTION_KEY_V2, etc.
   * PRODUCTION: Should call AWS Secrets Manager or similar
   */
  static loadFromEnv(): KeyRotationManager {
    const keys: Record<number, string> = {}

    // Load all ENCRYPTION_KEY_V* variables
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith('ENCRYPTION_KEY_V')) continue
      if (typeof value !== 'string') continue

      const version = parseInt(key.replace('ENCRYPTION_KEY_V', ''))
      if (isNaN(version)) continue

      keys[version] = value
    }

    // If no versioned keys, try legacy ENCRYPTION_KEY (version 1)
    if (Object.keys(keys).length === 0) {
      const legacyKey = process.env.ENCRYPTION_KEY
      if (legacyKey) {
        keys[1] = legacyKey
      }
    }

    if (Object.keys(keys).length === 0) {
      throw new Error(
        'No encryption keys found in environment. Set ENCRYPTION_KEY or ENCRYPTION_KEY_V* variables.'
      )
    }

    return new KeyRotationManager(keys)
  }
}

export const keyRotationManager = KeyRotationManager.loadFromEnv()
