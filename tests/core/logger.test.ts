import { describe, it, expect } from '../runner'
import { logger } from '../../core/logger/logger'

describe('Logger', () => {
  it('exports info, warn, error, debug methods', () => {
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  it('does not throw when called with message only', () => {
    // Manually verify: should not throw
    logger.info('hello')
    logger.warn('warn', { requestId: 'r1' })
    logger.error('error', { orgId: 'org1' })
  })
})
