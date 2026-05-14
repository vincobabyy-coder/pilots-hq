import { logger } from '../logger/logger'
import Redis from 'ioredis'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
  }
  return redis
}

interface SmsMessage {
  id: string
  phoneNumber: string
  message: string
  createdAt: number
  retries: number
  maxRetries: number
  nextRetryAt: number
}

/**
 * Process SMS queue
 * - Sends pending SMS messages
 * - Retries failed messages with exponential backoff
 * - Cleans up old records
 */
export async function processSmsQueue(): Promise<void> {
  try {
    const r = getRedis()

    // Get pending SMS messages from queue
    const queueKey = 'sms:queue:pending'
    const messages = await r.lrange(queueKey, 0, 99) // Process up to 100 messages per run

    if (messages.length === 0) {
      logger.debug('SMS queue empty')
      return
    }

    logger.info('Processing SMS queue', { messageCount: messages.length })

    const sentCount = { success: 0, failed: 0, rescheduled: 0 }

    for (const messageStr of messages) {
      try {
        const message: SmsMessage = JSON.parse(messageStr)

        // Check if it's time to retry this message
        if (message.nextRetryAt && Date.now() < message.nextRetryAt) {
          logger.debug('Message not ready for retry', {
            messageId: message.id,
            retryAt: new Date(message.nextRetryAt).toISOString(),
          })
          continue
        }

        // Send SMS via Twilio
        // const result = await twilioClient.messages.create({
        //   from: process.env.TWILIO_PHONE_NUMBER!,
        //   to: message.phoneNumber,
        //   body: message.message,
        // })

        // For MVP: simulate sending
        logger.info('SMS sent', { messageId: message.id, to: message.phoneNumber })
        sentCount.success++

        // Remove from queue
        await r.lrem(queueKey, 1, messageStr)

        // Add to sent history (TTL: 30 days)
        await r.set(
          `sms:sent:${message.id}`,
          JSON.stringify({ ...message, sentAt: Date.now() }),
          'EX',
          30 * 24 * 60 * 60
        )
      } catch (error) {
        const message: SmsMessage = JSON.parse(messageStr)

        if (message.retries < message.maxRetries) {
          // Reschedule with exponential backoff: 5min, 15min, 1hr, 4hr, 24hr
          const backoffMs = [5, 15, 60, 240, 1440][message.retries] * 60 * 1000
          message.retries++
          message.nextRetryAt = Date.now() + backoffMs

          await r.lpush(queueKey, JSON.stringify(message))
          logger.warn('SMS retry scheduled', {
            messageId: message.id,
            attempt: message.retries,
            nextRetryAt: new Date(message.nextRetryAt).toISOString(),
          })
          sentCount.rescheduled++
        } else {
          // Max retries exceeded
          logger.error('SMS delivery failed (max retries)', {
            messageId: message.id,
            error: (error as Error).message,
          })
          sentCount.failed++

          // Move to failed queue for manual review
          await r.lpush(`sms:queue:failed`, JSON.stringify(message))
          await r.lrem(queueKey, 1, messageStr)
        }
      }
    }

    logger.info('SMS queue processing completed', sentCount)
  } catch (error) {
    logger.error('SMS queue processor failed', { error: (error as Error).message })
    throw error
  }
}
