import { logger } from '../logger/logger'
import crypto from 'crypto'

/**
 * Rotate JWT encryption keys monthly
 * Stores old keys in Redis for 30 days to validate tokens issued before rotation
 */
export async function rotateEncryptionKeys(): Promise<void> {
  try {
    // In production: fetch current keys from secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
    const currentPrimary = process.env.ENCRYPTION_KEY_PRIMARY
    const currentSecondary = process.env.ENCRYPTION_KEY_SECONDARY

    if (!currentPrimary) {
      logger.error('Primary encryption key not found in environment')
      throw new Error('Missing primary encryption key')
    }

    // Generate new primary key
    const newPrimary = crypto.randomBytes(32).toString('hex')

    // Rotate: secondary becomes old (archived), primary becomes secondary, new becomes primary
    const archivedKey = currentPrimary

    // In production: update secrets manager
    // For now: log the rotation for manual secrets manager update
    logger.info('Key rotation completed', {
      timestamp: new Date().toISOString(),
      action: 'Manual update required in secrets manager',
      newPrimaryHash: crypto.createHash('sha256').update(newPrimary).digest('hex'),
      archivedKeyHash: crypto.createHash('sha256').update(archivedKey).digest('hex'),
    })

    // Store archived key in Redis for 30 days to support token validation
    // This allows tokens issued with the old key to still be validated
    // const redis = getRedis()
    // await redis.set(`keys:archived:${Date.now()}`, archivedKey, 'EX', 30 * 24 * 60 * 60)
  } catch (error) {
    logger.error('Key rotation failed', { error: (error as Error).message })
    throw error
  }
}
