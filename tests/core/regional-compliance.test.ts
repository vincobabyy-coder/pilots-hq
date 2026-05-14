import { describe, it, expect } from '../runner'
import {
  getBreachRequirements,
  getRetentionRequirements,
  logBreachDeadline,
} from '../../core/compliance/regional'

describe('RegionalCompliance', () => {
  it('NG breach notification deadline is 72 hours', () => {
    const req = getBreachRequirements('NG')
    expect(req.notificationDeadlineHours).toBe(72)
  })

  it('NG authority is NITDA', () => {
    const req = getBreachRequirements('NG')
    expect(req.authorityName.includes('NITDA')).toBe(true)
  })

  it('ZA authority URL points to inforegulator.org.za', () => {
    const req = getBreachRequirements('ZA')
    expect(req.authorityUrl.includes('inforegulator.org.za')).toBe(true)
  })

  it('ZA requires user notification', () => {
    const req = getBreachRequirements('ZA')
    expect(req.requiresUserNotification).toBe(true)
  })

  it('KE breach notification deadline is 72 hours', () => {
    const req = getBreachRequirements('KE')
    expect(req.notificationDeadlineHours).toBe(72)
  })

  it('KE authority is Office of the Data Protection Commissioner', () => {
    const req = getBreachRequirements('KE')
    expect(req.authorityName.includes('Data Protection Commissioner')).toBe(true)
  })

  it('EU breach notification deadline is 72 hours', () => {
    const req = getBreachRequirements('EU')
    expect(req.notificationDeadlineHours).toBe(72)
  })

  it('EU tracking_events retention is stricter than NG (30 vs 90 days)', () => {
    const eu = getRetentionRequirements('EU')
    const ng = getRetentionRequirements('NG')
    expect(eu['tracking_events']).toBe(30)
    expect(ng['tracking_events']).toBe(90)
    expect(eu['tracking_events'] < ng['tracking_events']).toBe(true)
  })

  it('EU driver_location retention is 14 days', () => {
    const eu = getRetentionRequirements('EU')
    expect(eu['driver_location']).toBe(14)
  })

  it('all regions have audit_logs retention of 2555 days (7 years)', () => {
    for (const region of ['NG', 'ZA', 'KE', 'EU'] as const) {
      const ret = getRetentionRequirements(region)
      expect(ret['audit_logs']).toBe(2555)
    }
  })

  it('logBreachDeadline does not throw', () => {
    const discoveredAt = new Date('2026-05-04T10:00:00Z')
    let threw = false
    try { logBreachDeadline('NG', discoveredAt) } catch { threw = true }
    expect(threw).toBe(false)
  })

  it('getBreachRequirements throws for unknown region', () => {
    expect(() => getBreachRequirements('XX' as never)).toThrow('not defined')
  })

  it('getRetentionRequirements throws for unknown region', () => {
    expect(() => getRetentionRequirements('XX' as never)).toThrow('not defined')
  })
})
