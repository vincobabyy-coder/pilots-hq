import { gdprCleanup } from '../../compliance/gdpr-cleanup'
import { logger } from '../../logger/logger'

export async function handleGdprCleanup(payload: unknown): Promise<void> {
  const p = payload as { task?: string }
  if (p?.task !== 'gdpr-cleanup') {
    logger.warn('gdpr-worker: unexpected task payload', { payload })
    return
  }

  logger.info('GDPR cleanup job starting')
  const results = await gdprCleanup.runAll()
  logger.info('GDPR cleanup job complete', { results })
}
