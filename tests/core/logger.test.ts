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
    logger.info('hello')
    logger.warn('warn', { requestId: 'r1' })
    logger.error('error', { orgId: 'org1' })
  })

  it('routes warn and error to stderr, info and debug to stdout', () => {
    const savedLevel = process.env.LOG_LEVEL
    // Force debug level so all four messages are emitted regardless of env config
    process.env.LOG_LEVEL = 'debug'

    const stderrChunks: string[] = []
    const stdoutChunks: string[] = []
    const origStderr = process.stderr.write.bind(process.stderr)
    const origStdout = process.stdout.write.bind(process.stdout)

    process.stderr.write = ((chunk: unknown) => { stderrChunks.push(String(chunk)); return true }) as typeof process.stderr.write
    process.stdout.write = ((chunk: unknown) => { stdoutChunks.push(String(chunk)); return true }) as typeof process.stdout.write

    try {
      logger.warn('a warn')
      logger.error('an error')
      logger.info('an info')
      logger.debug('a debug')
    } finally {
      process.stderr.write = origStderr
      process.stdout.write = origStdout
      if (savedLevel === undefined) {
        delete process.env.LOG_LEVEL
      } else {
        process.env.LOG_LEVEL = savedLevel
      }
    }

    expect(stdoutChunks.some(c => c.includes('"level":"debug"'))).toBe(true)
    expect(stdoutChunks.some(c => c.includes('"level":"info"'))).toBe(true)
    expect(stderrChunks.some(c => c.includes('"level":"warn"'))).toBe(true)
    expect(stderrChunks.some(c => c.includes('"level":"error"'))).toBe(true)
  })

  it('drops messages below the configured LOG_LEVEL', () => {
    const savedLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'warn'

    const stdoutChunks: string[] = []
    const origStdout = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: unknown) => { stdoutChunks.push(String(chunk)); return true }) as typeof process.stdout.write

    try {
      logger.debug('should be dropped')
      logger.info('also should be dropped')
    } finally {
      process.stdout.write = origStdout
      if (savedLevel === undefined) {
        delete process.env.LOG_LEVEL
      } else {
        process.env.LOG_LEVEL = savedLevel
      }
    }

    expect(stdoutChunks.some(c => c.includes('"level":"debug"'))).toBe(false)
    expect(stdoutChunks.some(c => c.includes('"level":"info"'))).toBe(false)
  })
})
