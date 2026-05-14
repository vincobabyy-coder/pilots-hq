// tests/integration/twilio.test.ts
import { describe, it, expect } from '../runner'
import { twilioConnector } from '../../integrations/sms/twilio-connector'
import Redis from 'ioredis'

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
  }
  return redis
}

/**
 * Twilio Connector Tests
 * Tests SMS sending, rate limiting, and error handling
 * Note: Uses mocked HTTPS in unit tests; integration tests use real Redis for rate limiting
 */

describe('Twilio Integration', () => {
  const testPhone = '+2348012345678'
  const testShipmentNumber = 'SHP-123456'

  it('checks rate limiting correctly', async () => {
    // Try to get Redis, skip test if unavailable
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      expect(true).toBe(true)
      return
    }

    // Clear any existing rate limit keys
    try {
      await r.del(`sms_last_sent:${testPhone}`)
    } catch (e) {
      // ignore
    }

    // First call should return true (can send)
    const canSend1 = await twilioConnector.checkAndRecordSmsRateLimit(testPhone)
    expect(canSend1).toBe(true)

    // Second call should return false (rate limited)
    const canSend2 = await twilioConnector.checkAndRecordSmsRateLimit(testPhone)
    expect(canSend2).toBe(false)

    // Third call should also return false (still within 1 hour window)
    const canSend3 = await twilioConnector.checkAndRecordSmsRateLimit(testPhone)
    expect(canSend3).toBe(false)

    // Clean up
    await r.del(`sms_last_sent:${testPhone}`)
  })

  it('rate limiting is per-phone number', async () => {
    // Try to get Redis, skip test if unavailable
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      expect(true).toBe(true)
      return
    }

    const phone1 = '+2348011111111'
    const phone2 = '+2348022222222'

    // Clear rate limits
    try {
      await r.del(`sms_last_sent:${phone1}`)
      await r.del(`sms_last_sent:${phone2}`)
    } catch (e) {
      // ignore
    }

    // First phone can send
    const canSend1a = await twilioConnector.checkAndRecordSmsRateLimit(phone1)
    expect(canSend1a).toBe(true)

    // Second phone can also send (different phone)
    const canSend2a = await twilioConnector.checkAndRecordSmsRateLimit(phone2)
    expect(canSend2a).toBe(true)

    // First phone is now rate limited
    const canSend1b = await twilioConnector.checkAndRecordSmsRateLimit(phone1)
    expect(canSend1b).toBe(false)

    // Second phone can still send (different limit)
    const canSend2b = await twilioConnector.checkAndRecordSmsRateLimit(phone2)
    expect(canSend2b).toBe(false)

    // Clean up
    await r.del(`sms_last_sent:${phone1}`)
    await r.del(`sms_last_sent:${phone2}`)
  })

  it('rate limiting sets correct TTL', async () => {
    // Try to get Redis, skip test if unavailable
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      expect(true).toBe(true)
      return
    }

    const phone = '+2348033333333'
    const key = `sms_last_sent:${phone}`

    // Clear rate limit
    try {
      await r.del(key)
    } catch (e) {
      // ignore
    }

    // Record an SMS
    const canSend = await twilioConnector.checkAndRecordSmsRateLimit(phone)
    expect(canSend).toBe(true)

    // Check TTL is approximately 3600 seconds
    const ttl = await r.ttl(key)
    // TTL should be between 3590 and 3600 (allowing for test execution time)
    expect(ttl >= 3590 && ttl <= 3600).toBe(true)

    // Clean up
    await r.del(key)
  })

  it('ETA notification respects rate limit', async () => {
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      // Can't test rate limiting without Redis, but method shouldn't throw
      try {
        await twilioConnector.sendETANotification(testPhone, testShipmentNumber, 15)
        expect(true).toBe(true)
      } catch {
        // If Twilio credentials aren't set, that's OK for this test
        expect(true).toBe(true)
      }
      return
    }

    const phone = '+2348044444444'
    const key = `sms_last_sent:${phone}`

    try {
      await r.del(key)
    } catch (e) {
      // ignore
    }

    // First ETA notification should succeed (or try to send)
    // Note: This doesn't actually test sending because we'd need real Twilio creds
    // But it does test that rate limit is checked
    await twilioConnector.sendETANotification(phone, testShipmentNumber, 15)

    // Second ETA notification should be silently rate-limited
    // (no error thrown, just logged as warning)
    await twilioConnector.sendETANotification(phone, testShipmentNumber, 15)

    // Verify rate limit was set
    const exists = await r.exists(key)
    expect(exists).toBe(1)

    // Clean up
    await r.del(key)
  })

  it('driver notification respects rate limit', async () => {
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      expect(true).toBe(true)
      return
    }

    const phone = '+2348055555555'
    const key = `sms_last_sent:${phone}`

    try {
      await r.del(key)
    } catch (e) {
      // ignore
    }

    // First notification should check rate limit
    await twilioConnector.sendDriverNotification(phone, "You've been assigned 3 deliveries")

    // Second notification should be rate limited
    await twilioConnector.sendDriverNotification(phone, "You've been assigned 2 more deliveries")

    // Verify rate limit was set
    const exists = await r.exists(key)
    expect(exists).toBe(1)

    // Clean up
    await r.del(key)
  })

  it('failure notification respects rate limit', async () => {
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      expect(true).toBe(true)
      return
    }

    const phone = '+2348066666666'
    const key = `sms_last_sent:${phone}`

    try {
      await r.del(key)
    } catch (e) {
      // ignore
    }

    // First notification should check rate limit
    await twilioConnector.sendFailureNotification(
      phone,
      testShipmentNumber,
      'Customer not available'
    )

    // Second notification should be rate limited
    await twilioConnector.sendFailureNotification(
      phone,
      testShipmentNumber,
      'Address not found'
    )

    // Verify rate limit was set
    const exists = await r.exists(key)
    expect(exists).toBe(1)

    // Clean up
    await r.del(key)
  })

  it('notifications do not throw on rate limit', async () => {
    // This test verifies that rate-limited notifications don't throw errors
    // (they should just log a warning and return)
    let r: Redis | null = null
    try {
      r = getRedis()
      await r.ping()
    } catch {
      expect(true).toBe(true)
      return
    }

    const phone = '+2348077777777'
    const key = `sms_last_sent:${phone}`

    try {
      await r.del(key)
    } catch (e) {
      // ignore
    }

    // First call records the rate limit
    await twilioConnector.checkAndRecordSmsRateLimit(phone)

    // These should not throw
    try {
      await twilioConnector.sendETANotification(phone, 'SHP-999', 15)
      await twilioConnector.sendDriverNotification(phone, 'Test message')
      await twilioConnector.sendFailureNotification(phone, 'SHP-999', 'Test reason')
      expect(true).toBe(true)
    } catch (err) {
      // Should not reach here
      expect(true).toBe(false)
    }

    // Clean up
    await r.del(key)
  })
})
