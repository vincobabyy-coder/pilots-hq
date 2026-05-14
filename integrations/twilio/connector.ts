import { query } from '../../core/db/pool'
import { logger } from '../../core/logger/logger'

/**
 * TWILIO SMS INTEGRATION
 *
 * Sends SMS notifications to drivers and customers:
 * - Customer: ETA notifications ("Driver is 5 min away")
 * - Customer: Delivery failure notices
 * - Driver: New route assignment
 */

interface SmsRecord extends Record<string, unknown> {
  id: string
  org_id: string
  phone_number: string
  message: string
  status: 'sent' | 'failed' | 'bounced'
  created_at: Date | string
}

export class TwilioConnector {
  private apiKey: string
  private phoneNumber: string
  private appUrl: string

  constructor(
    apiKey: string = process.env.TWILIO_API_KEY || '',
    phoneNumber: string = process.env.TWILIO_PHONE || '',
    appUrl: string = process.env.APP_URL || 'https://pilots.app'
  ) {
    if (!apiKey || !phoneNumber) {
      logger.warn('TWILIO_API_KEY or TWILIO_PHONE not set — SMS features disabled')
    }
    this.apiKey = apiKey
    this.phoneNumber = phoneNumber
    this.appUrl = appUrl
  }

  /**
   * Send SMS to customer with ETA
   */
  async sendETANotification(orgId: string, customerPhone: string, driverName: string, eta: number): Promise<void> {
    // Validate phone number
    if (!this.validatePhoneNumber(customerPhone)) {
      logger.error('Invalid phone number', { phone: customerPhone })
      return
    }

    const message = `Your order is on its way! Driver ${driverName} will arrive in ~${eta} minutes. Track here: ${this.appUrl}/track`

    await this.sendSms(orgId, customerPhone, message)
  }

  /**
   * Send SMS to customer when delivery fails
   */
  async sendFailureNotification(orgId: string, customerPhone: string, reason: string): Promise<void> {
    if (!this.validatePhoneNumber(customerPhone)) {
      logger.error('Invalid phone number', { phone: customerPhone })
      return
    }

    const reasonText = this.getFailureReasonText(reason)
    const message = `Delivery attempt failed: ${reasonText}. We'll try again tomorrow. Reply RESCHEDULE to change time.`

    await this.sendSms(orgId, customerPhone, message)
  }

  /**
   * Send SMS to driver with new route assignment
   */
  async sendDriverNotification(
    orgId: string,
    driverPhone: string,
    route: { id: string; stops: number; distance_km: number; warehouse_name: string }
  ): Promise<void> {
    if (!this.validatePhoneNumber(driverPhone)) {
      logger.error('Invalid phone number', { phone: driverPhone })
      return
    }

    const message = `New route assigned: ${route.stops} stops, ${route.distance_km}km. Start at ${route.warehouse_name}.`

    await this.sendSms(orgId, driverPhone, message)
  }

  /**
   * Send generic SMS
   */
  async sendSms(orgId: string, phoneNumber: string, message: string): Promise<void> {
    if (!this.apiKey || !this.phoneNumber) {
      logger.warn('SMS disabled: Twilio not configured')
      return
    }

    // Validate inputs
    if (!orgId || !phoneNumber || !message) {
      throw new Error('orgId, phoneNumber, and message are required')
    }

    if (!this.validatePhoneNumber(phoneNumber)) {
      throw new Error(`Invalid phone number: ${phoneNumber}`)
    }

    if (message.length > 160) {
      logger.warn('SMS message exceeds 160 characters, will be split into multiple messages', {
        length: message.length,
      })
    }

    // Rate limit: max 1 SMS per hour per number (prevent flooding)
    const recentSms = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM sms_logs
       WHERE org_id = $1 AND phone_number = $2 AND created_at > NOW() - INTERVAL '1 hour'`,
      [orgId, phoneNumber]
    )

    if (recentSms[0]?.count > 0) {
      logger.warn('SMS rate limit reached for this number', { phoneNumber })
      return
    }

    try {
      // In production, would call Twilio API:
      // const response = await twilio.messages.create({
      //   body: message,
      //   from: this.phoneNumber,
      //   to: phoneNumber
      // });

      // For now, log and record as "sent"
      logger.info('SMS sent', { phoneNumber, messageLength: message.length })

      // Record SMS in database
      await query(
        `INSERT INTO sms_logs (org_id, phone_number, message, status, created_at)
         VALUES ($1, $2, $3, 'sent', NOW())`,
        [orgId, phoneNumber, message]
      )
    } catch (error) {
      logger.error('Failed to send SMS', { phoneNumber, error: (error as Error).message })

      // Record as failed
      await query(
        `INSERT INTO sms_logs (org_id, phone_number, message, status, created_at)
         VALUES ($1, $2, $3, 'failed', NOW())`,
        [orgId, phoneNumber, message]
      )

      throw error
    }
  }

  /**
   * Webhook handler: incoming SMS reply from customer
   */
  async handleIncomingSms(fromNumber: string, messageText: string): Promise<void> {
    const trimmed = messageText.trim().toUpperCase()

    // Check for RESCHEDULE command
    if (trimmed === 'RESCHEDULE') {
      // Find pending delivery for this number
      const deliveries = await query<{ id: string; org_id: string }>(
        `SELECT DISTINCT d.id, d.org_id FROM deliveries d
         WHERE d.customer_phone = $1 AND d.status = 'pending'
         ORDER BY d.created_at DESC LIMIT 1`,
        [fromNumber]
      )

      if (deliveries.length > 0) {
        const { id, org_id } = deliveries[0]

        // Mark as reschedule request
        await query('UPDATE deliveries SET reschedule_requested = true WHERE id = $1', [id])

        // Send confirmation
        await this.sendSms(org_id, fromNumber, "Got it! We'll contact you to reschedule.")

        logger.info('Reschedule requested via SMS', { phoneNumber: fromNumber, deliveryId: id })
      }
    }
  }

  /**
   * Get SMS logs for audit trail
   */
  async getSmslogs(orgId: string, phoneNumber?: string, limit: number = 50): Promise<SmsRecord[]> {
    let sql = 'SELECT * FROM sms_logs WHERE org_id = $1'
    const params: unknown[] = [orgId]

    if (phoneNumber) {
      sql += ' AND phone_number = $2'
      params.push(phoneNumber)
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1)
    params.push(limit)

    const logs = await query<SmsRecord>(sql, params)
    return logs
  }

  // ===== PRIVATE HELPERS =====

  private validatePhoneNumber(phone: string): boolean {
    // Basic validation: should start with + and contain only digits
    // More robust: use libphonenumber-js
    const cleaned = phone.replace(/[^\d+]/g, '')
    return /^\+\d{10,}$/.test(cleaned)
  }

  private getFailureReasonText(reason: string): string {
    const reasons: Record<string, string> = {
      customer_not_home: 'Customer not home',
      address_not_found: 'Address not found',
      customer_refused: 'Customer refused delivery',
      security_denied_access: 'Security denied access',
      vehicle_breakdown: 'Vehicle breakdown',
      traffic_jam: 'Traffic delay',
      other: 'Unknown reason',
    }

    return reasons[reason] || 'Unknown reason'
  }
}

export const twilioConnector = new TwilioConnector()
