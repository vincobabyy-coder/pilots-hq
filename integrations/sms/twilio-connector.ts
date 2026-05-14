import * as https from 'https'
import Redis from 'ioredis'
import { logger } from '../../core/logger/logger'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
    redis.on('error', (err) =>
      logger.warn('Twilio Redis error', { error: err.message })
    )
  }
  return redis
}

/**
 * TWILIO SMS INTEGRATION
 *
 * Sends SMS notifications via Twilio API:
 * - ETA notifications for shipments
 * - Driver notifications for assignments
 * - Failure notifications for logistics issues
 * - Rate limiting (1 SMS per phone per hour)
 */

interface TwilioResponse {
  sid?: string
  error_code?: string
  error_message?: string
}

export class TwilioConnector {
  private accountSid: string
  private authToken: string
  private fromPhoneNumber: string

  constructor(
    accountSid: string = process.env.TWILIO_ACCOUNT_SID || '',
    authToken: string = process.env.TWILIO_AUTH_TOKEN || '',
    fromPhoneNumber: string = process.env.TWILIO_PHONE || ''
  ) {
    this.accountSid = accountSid
    this.authToken = authToken
    this.fromPhoneNumber = fromPhoneNumber
  }

  /**
   * Check if SMS can be sent to this phone number
   * Rate limit: 1 SMS per phone per hour
   * Returns true if SMS was NOT recently sent (OK to send)
   * Returns false if SMS was sent within the last hour (rate limited)
   */
  async checkAndRecordSmsRateLimit(phone: string): Promise<boolean> {
    try {
      const r = getRedis()
      const key = `sms_last_sent:${phone}`
      // Use SET with NX: only set if key doesn't exist
      // Returns 'OK' if set successfully (first time), null if already exists
      const result = await r.set(key, '1', 'NX')
      if (result === 'OK') {
        // Key was set successfully; now set the expiration
        await r.expire(key, 3600)
        return true
      }
      return false // Key already exists, rate limited
    } catch (err) {
      logger.error('SMS rate limit check failed; failing open', {
        phone,
        error: (err as Error).message,
      })
      return true // Fail open: allow SMS if Redis is down
    }
  }

  /**
   * Send SMS via Twilio API
   * Uses HTTPS POST to api.twilio.com with Basic auth
   * Returns message SID on success
   */
  private async sendSmsRaw(to: string, body: string): Promise<string> {
    if (!this.accountSid || !this.authToken || !this.fromPhoneNumber) {
      throw new Error('Twilio credentials not configured')
    }

    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')
      const bodyStr = new URLSearchParams({
        To: to,
        From: this.fromPhoneNumber,
        Body: body,
      }).toString()

      const options = {
        hostname: 'api.twilio.com',
        port: 443,
        path: `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }

      const req = https.request(options, (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          try {
            const response = JSON.parse(raw) as TwilioResponse
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Twilio API error: ${response.error_message || 'Unknown error'}`))
            } else if (response.sid) {
              resolve(response.sid)
            } else {
              reject(new Error('Twilio: No SID in response'))
            }
          } catch (e) {
            reject(new Error(`Failed to parse Twilio response: ${(e as Error).message}`))
          }
        })
      })

      req.on('error', reject)
      req.write(bodyStr)
      req.end()
    })
  }

  /**
   * Send ETA notification to customer
   * Example: "Your delivery is arriving in 15 minutes. Shipment #SHP-001234"
   */
  async sendETANotification(phone: string, shipmentNumber: string, etaMinutes: number): Promise<void> {
    const canSend = await this.checkAndRecordSmsRateLimit(phone)
    if (!canSend) {
      logger.warn('ETA notification rate limited', { phone, shipmentNumber })
      return
    }

    try {
      const body = `Your delivery is arriving in ${etaMinutes} minutes. Shipment #${shipmentNumber}`
      const sid = await this.sendSmsRaw(phone, body)
      logger.info('ETA notification sent', { phone, shipmentNumber, messageSid: sid })
    } catch (err) {
      logger.error('Failed to send ETA notification', {
        phone,
        shipmentNumber,
        error: (err as Error).message,
      })
      // Do not throw; notifications are best-effort
    }
  }

  /**
   * Send driver assignment notification
   * Example: "You've been assigned 3 deliveries today"
   */
  async sendDriverNotification(phone: string, message: string): Promise<void> {
    const canSend = await this.checkAndRecordSmsRateLimit(phone)
    if (!canSend) {
      logger.warn('Driver notification rate limited', { phone })
      return
    }

    try {
      const sid = await this.sendSmsRaw(phone, message)
      logger.info('Driver notification sent', { phone, messageSid: sid })
    } catch (err) {
      logger.error('Failed to send driver notification', {
        phone,
        error: (err as Error).message,
      })
      // Do not throw; notifications are best-effort
    }
  }

  /**
   * Send failure notification (delivery failed, customer unavailable, etc.)
   * Example: "Delivery attempt failed: Customer not available. Retry tomorrow?"
   */
  async sendFailureNotification(
    phone: string,
    shipmentNumber: string,
    reason: string
  ): Promise<void> {
    const canSend = await this.checkAndRecordSmsRateLimit(phone)
    if (!canSend) {
      logger.warn('Failure notification rate limited', { phone, shipmentNumber })
      return
    }

    try {
      const body = `Delivery attempt failed for shipment #${shipmentNumber}: ${reason}`
      const sid = await this.sendSmsRaw(phone, body)
      logger.info('Failure notification sent', { phone, shipmentNumber, messageSid: sid })
    } catch (err) {
      logger.error('Failed to send failure notification', {
        phone,
        shipmentNumber,
        error: (err as Error).message,
      })
      // Do not throw; notifications are best-effort
    }
  }
}

export const twilioConnector = new TwilioConnector()
